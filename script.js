// --- Referencias DOM ---
const cameraInput = document.getElementById('camera-input');
const fileInput = document.getElementById('file-input');
const imagePreview = document.getElementById('image-preview');
const videoFeed = document.getElementById('video-feed'); // Nuevo
const detectionCanvas = document.getElementById('detection-canvas'); // Nuevo Canvas
const ctx = detectionCanvas.getContext('2d');
const placeholderText = document.getElementById('placeholder-text');
const consoleLog = document.getElementById('console-log');
const resultsArea = document.getElementById('results-area');
const btnCamera = document.getElementById('btn-camera'); // Nuevo
const btnCameraText = document.getElementById('btn-camera-text'); // Nuevo
const btnSwitchCamera = document.getElementById('btn-switch-camera'); // Nuevo botón switch
const btnToggleVoice = document.getElementById('btn-toggle-voice');
const btnToggleRoi = document.getElementById('btn-toggle-roi');
const confidenceSlider = document.getElementById('confidence-slider');
const confidenceValue = document.getElementById('confidence-value');
const resolutionSelect = document.getElementById('resolution-select'); // Nuevo selector
const roiOverlay = document.getElementById('roi-overlay');
const loadingOverlay = document.getElementById('loading-overlay'); // Referencia a la pantalla de carga
const roiBox = document.getElementById('roi-box'); // Referencia actualizada por ID
const roiResize = document.getElementById('roi-resize'); // Nuevo manejador de resize
const iconVoiceOn = document.getElementById('icon-voice-on');
const iconVoiceOff = document.getElementById('icon-voice-off');
const statusDot = document.getElementById('status-dot'); // Nuevo indicador
const statusText = document.getElementById('status-text'); // Nuevo texto estado
let stream = null; // Variable para guardar el stream de video
let objectDetector = null; // Modelo COCO-SSD
let isDetecting = false;
let lastFrameTime = 0; // Variable para cálculo de FPS
let lastSpokenText = ''; // Control de voz: último texto dicho
let lastSpeechTime = 0; // Control de voz: tiempo de última locución
let isObjectListVoiceEnabled = true; // Voz para lista de objetos activada por defecto
let isRoiActive = false; // Estado de la Zona de Peligro
let currentFacingMode = 'environment'; // 'environment' (trasera) o 'user' (frontal)
let minConfidence = 0.6; // Umbral de confianza inicial (60%)
let currentResolution = 'medium'; // Resolución por defecto
// Variables para Drag & Resize
let isDraggingRoi = false;
let isResizingRoi = false;
let dragStartX, dragStartY;
let initialRoiLeft, initialRoiTop, initialRoiW, initialRoiH;

// --- Inicialización ---
document.addEventListener('DOMContentLoaded', async () => {
    setupRoiInteractions(); // Inicializar eventos de ROI
    await loadModel();
});

async function loadModel() {
    log('Cargando modelo de detección (COCO-SSD)...', 'INFO');
    try {
        objectDetector = await cocoSsd.load();
        log('Modelo cargado. Sistema listo para detectar.', 'SUCCESS');
        // Ocultar pantalla de carga cuando el modelo esté listo
        loadingOverlay.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => loadingOverlay.classList.add('hidden'), 500);
    } catch (err) {
        log('Error cargando modelo: ' + err.message, 'ERROR');
        // Mostrar error en la pantalla de carga si falla
        const loadingText = loadingOverlay.querySelector('h2');
        const loadingSub = loadingOverlay.querySelector('p');
        if(loadingText) {
            loadingText.innerText = "ERROR DE CARGA";
            loadingText.classList.replace('text-cyan-400', 'text-red-500');
        }
        if(loadingSub) loadingSub.innerText = "Verifique su conexión y recargue.";
    }
}

// --- Event Listeners ---
cameraInput.addEventListener('change', handleImageUpload);
fileInput.addEventListener('change', handleImageUpload);
btnCamera.addEventListener('click', handleCameraAction); // Nuevo listener
btnSwitchCamera.addEventListener('click', switchCamera); // Listener para cambiar cámara
btnToggleVoice.addEventListener('click', toggleVoice);
btnToggleRoi.addEventListener('click', toggleRoi);
if (confidenceSlider) {
    confidenceSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        minConfidence = val / 100;
        if (confidenceValue) confidenceValue.innerText = val + '%';
    });
}
if (resolutionSelect) {
    resolutionSelect.addEventListener('change', async (e) => {
        currentResolution = e.target.value;
        log(`Resolución cambiada a: ${currentResolution.toUpperCase()}`, 'INFO');
        if (stream) {
            stopCamera();
            await initCamera();
        }
    });
}

// --- Lógica de Cámara en Vivo (GetUserMedia) ---
async function handleCameraAction() {
    if (stream) {
        stopCamera();
    } else {
        // Iniciar cámara y detección
        await initCamera();
    }
}

async function initCamera() {
    // Verificación de seguridad: getUserMedia requiere HTTPS o localhost
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        log('API de cámara no disponible (¿Usando HTTP?). Usando método nativo.', 'WARN');
        cameraInput.click(); // Fallback al selector de archivos
        return;
    }

    try {
        // Configurar canvas y empezar loop cuando el video tenga datos
        videoFeed.onloadeddata = () => {
            detectionCanvas.width = videoFeed.videoWidth;
            detectionCanvas.height = videoFeed.videoHeight;
            // Asegurar que el canvas coincida con el modo del video (cover)
            detectionCanvas.classList.remove('object-contain');
            detectionCanvas.classList.add('object-cover');
            
            // Configurar efecto espejo si es cámara frontal
            if (currentFacingMode === 'user') {
                videoFeed.style.transform = 'scaleX(-1)';
            } else {
                videoFeed.style.transform = 'none';
            }

            isDetecting = true;
            updateSystemStatus(true); // Actualizar indicador a ONLINE
            lastFrameTime = 0; // Resetear contador al iniciar
            predictFrame(); // Iniciar bucle de detección
        };

        const constraints = {
            video: {
                facingMode: currentFacingMode,
                ...getResolutionConstraints(currentResolution)
            }
        };

        stream = await navigator.mediaDevices.getUserMedia({ 
            video: constraints.video
        });
        videoFeed.srcObject = stream;
        videoFeed.classList.remove('hidden');
        imagePreview.classList.add('hidden');
        placeholderText.classList.add('hidden');
        btnCameraText.innerText = "DETENER"; // Cambiar texto del botón
        
        log('Cámara iniciada. Detección en tiempo real activa.', 'INFO');
    } catch (err) {
        console.error("Error al acceder a la cámara:", err);
        log('No se pudo acceder a la cámara. Abriendo selector de archivos.', 'WARN');
        cameraInput.click(); // Fallback si falla (ej: permiso denegado)
    }
}

function getResolutionConstraints(quality) {
    switch(quality) {
        case 'low': return { width: { ideal: 640 }, height: { ideal: 480 } };
        case 'high': return { width: { ideal: 1920 }, height: { ideal: 1080 } };
        case 'medium': 
        default: return { width: { ideal: 1280 }, height: { ideal: 720 } };
    }
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    videoFeed.classList.add('hidden');
    btnCameraText.innerText = "INICIAR SISTEMA";
    isDetecting = false;
    updateSystemStatus(false); // Actualizar indicador a OFFLINE
    ctx.clearRect(0, 0, detectionCanvas.width, detectionCanvas.height);
    log('Sistema detenido.', 'INFO');
}

async function switchCamera() {
    // Alternar modo
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    log(`Cambiando a cámara ${currentFacingMode === 'user' ? 'frontal' : 'trasera'}...`, 'INFO');
    
    if (stream) {
        stopCamera();
        await initCamera();
    }
}

// --- Bucle de Detección en Tiempo Real ---
async function predictFrame() {
    if (!isDetecting || !objectDetector) return;

    // Cálculo de FPS
    const now = performance.now();
    const fps = lastFrameTime ? 1000 / (now - lastFrameTime) : 0;
    lastFrameTime = now;

    // 1. Detectar objetos en el cuadro actual de video
    const predictionsRaw = await objectDetector.detect(videoFeed);
    
    // Aplicar filtro de confianza
    const predictions = predictionsRaw.filter(p => p.score >= minConfidence);
    
    // 2. Limpiar canvas anterior
    ctx.clearRect(0, 0, detectionCanvas.width, detectionCanvas.height);
    
    // Dibujar FPS en la esquina
    ctx.textBaseline = 'top';
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#00FF00'; // Verde brillante
    ctx.fillText(`FPS: ${fps.toFixed(1)}`, 10, 10);

    // --- Lógica de ROI (Zona de Peligro) ---
    let dangerDetected = false;
    let roiBounds = null;
    let minDistance = Infinity; // Distancia mínima de una persona al ROI
    let roiCenter = null;
    let roiRadius = 0;

    if (isRoiActive && roiBox) {
        // Calcular dimensiones de la ROI en coordenadas del video
        // Teniendo en cuenta que object-cover escala el video para llenar el contenedor
        const vw = videoFeed.videoWidth;
        const vh = videoFeed.videoHeight;
        const cw = videoFeed.clientWidth;
        const ch = videoFeed.clientHeight;
        
        // Calcular escala (Video Pixels / Screen Pixels)
        const scaleX = vw / cw;
        const scaleY = vh / ch;
        const scaleFactor = Math.max(scaleX, scaleY); // object-cover usa el mayor
        
        // Calcular dimensiones renderizadas del video en pantalla
        const renderedWidth = vw / scaleFactor;
        const renderedHeight = vh / scaleFactor;
        
        // Calcular offsets (centrado del video en el contenedor)
        const offsetX = (cw - renderedWidth) / 2;
        const offsetY = (ch - renderedHeight) / 2;
        
        // Obtener posición actual del ROI en pantalla
        const boxRect = roiBox.getBoundingClientRect();
        const containerRect = roiOverlay.getBoundingClientRect();
        
        const roiScreenX = boxRect.left - containerRect.left;
        const roiScreenY = boxRect.top - containerRect.top;
        
        // Convertir coordenadas de Pantalla a Video
        let roiVideoX = (roiScreenX - offsetX) * scaleFactor;
        const roiVideoY = (roiScreenY - offsetY) * scaleFactor;
        const roiVideoW = boxRect.width * scaleFactor;
        const roiVideoH = boxRect.height * scaleFactor;
        
        // Ajuste para modo espejo (Cámara frontal)
        if (currentFacingMode === 'user') {
            roiVideoX = vw - (roiVideoX + roiVideoW);
        }

        roiBounds = { x: roiVideoX, y: roiVideoY, w: roiVideoW, h: roiVideoH };
        
        // Calcular centro y radio promedio para lógica de proximidad
        roiCenter = { x: roiVideoX + roiVideoW / 2, y: roiVideoY + roiVideoH / 2 };
        roiRadius = (roiVideoW + roiVideoH) / 4;

        // Dibujar borde de ROI en canvas para depuración visual (opcional)
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(roiBounds.x, roiBounds.y, roiBounds.w, roiBounds.h);
        ctx.setLineDash([]);
    }

    ctx.font = '16px sans-serif';

    // 3. Dibujar resultados
    predictions.forEach(prediction => {
        let x = prediction.bbox[0];
        const y = prediction.bbox[1];
        const width = prediction.bbox[2];
        const height = prediction.bbox[3];

        // Ajuste para modo espejo (Cámara frontal)
        if (currentFacingMode === 'user') {
            x = detectionCanvas.width - x - width;
        }

        // Generar color dinámico basado en la clase del objeto
        let color = getColorForClass(prediction.class);
        let lineWidth = 2;

        // Verificar si el objeto está en la zona de peligro
        if (roiBounds) {
            const cx = x + width / 2;
            const cy = y + height / 2;

            // Calcular proximidad si es una persona
            if (prediction.class === 'person') {
                const dist = Math.sqrt(Math.pow(cx - roiCenter.x, 2) + Math.pow(cy - roiCenter.y, 2));
                if (dist < minDistance) minDistance = dist;
            }

            // Si el centro del objeto está dentro del ROI
            if (cx >= roiBounds.x && cx <= roiBounds.x + roiBounds.w &&
                cy >= roiBounds.y && cy <= roiBounds.y + roiBounds.h) {
                
                // Solo activar alerta si es una persona
                if (prediction.class === 'person') {
                    dangerDetected = true;
                    color = '#FF0000'; // Rojo alerta
                    lineWidth = 6;
                    ctx.fillStyle = '#FF0000';
                    ctx.font = 'bold 20px sans-serif';
                    ctx.fillText("⚠️ PELIGRO", x, y - 25);
                }
            }
        }

        // Recuadro
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(x, y, width, height);

        // Fondo de etiqueta
        ctx.fillStyle = color;
        const translatedText = translate(prediction.class);
        const textWidth = ctx.measureText(translatedText).width;
        ctx.fillRect(x, y, textWidth + 4, 20);

        // Texto de etiqueta
        ctx.fillStyle = '#000000';
        ctx.fillText(translatedText, x, y);
    });

    // 4. Actualizar UI con lo que se está viendo
    updateResultsUI(predictions, dangerDetected);

    // Efecto visual dinámico en el ROI (Proximidad)
    if (isRoiActive && roiBox) {
        const roiLabel = roiBox.querySelector('div'); // Etiqueta de texto

        if (dangerDetected) {
            // ESTADO: PELIGRO (Dentro)
            roiBox.style.borderColor = '#ef4444'; // Red-500
            roiBox.style.backgroundColor = 'rgba(239, 68, 68, 0.4)';
            roiBox.classList.add('animate-pulse');
            
            if (roiLabel) {
                roiLabel.style.backgroundColor = '#dc2626'; // Red-600
                roiLabel.innerText = "PELIGRO DETECTADO";
            }
        } else {
            // ESTADO: PROXIMIDAD (Fuera)
            roiBox.classList.remove('animate-pulse');
            
            let hue = 120; // Verde (Seguro)
            let labelText = "ZONA SEGURA";
            let alpha = 0.1;

            if (minDistance !== Infinity) {
                // Definir zonas de distancia
                const safeZone = roiRadius * 4; // Distancia segura
                const dangerZone = roiRadius;   // Borde del ROI

                // Calcular factor 0 (peligro) a 1 (seguro)
                const factor = Math.max(0, Math.min(1, (minDistance - dangerZone) / (safeZone - dangerZone)));
                
                hue = factor * 120; // Interpolación de color (0=Rojo, 120=Verde)
                alpha = 0.1 + (1 - factor) * 0.2; // Más opaco al acercarse

                if (hue < 40) labelText = "PELIGRO PRÓXIMO";
                else if (hue < 80) labelText = "PRECAUCIÓN";
            }

            roiBox.style.borderColor = `hsla(${hue}, 100%, 50%, 1)`;
            roiBox.style.backgroundColor = `hsla(${hue}, 100%, 50%, ${alpha})`;
            
            if (roiLabel) {
                roiLabel.style.backgroundColor = `hsla(${hue}, 100%, 40%, 1)`;
                roiLabel.innerText = labelText;
            }
        }
    }

    // 5. Solicitar el siguiente cuadro
    requestAnimationFrame(predictFrame);
}

// --- Funciones de Utilidad ---
function log(msg, type = 'INFO') {
    const time = new Date().toLocaleTimeString('es-CL', { hour12: false });
    const p = document.createElement('p');
    let colorClass = 'text-green-500';
    if (type === 'ERROR') colorClass = 'text-red-500';
    if (type === 'WARN') colorClass = 'text-yellow-500';
    
    p.innerHTML = `<span class="text-slate-500">[${time}]</span> <span class="${colorClass}">${msg}</span>`;
    consoleLog.appendChild(p);
    consoleLog.scrollTop = consoleLog.scrollHeight;
}

function clearLogs() {
    consoleLog.innerHTML = '';
    log('Logs limpiados.', 'INFO');
}

// --- Manejo de Imagen ---
function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Mostrar preview
    const reader = new FileReader();
    reader.onload = function(event) {
        imagePreview.src = event.target.result;
        imagePreview.classList.remove('hidden');
        placeholderText.classList.add('hidden');
        
        // Para imágenes estáticas, también podemos detectar
        detectStaticImage(imagePreview);
    };
    reader.readAsDataURL(file);
}

// --- Detección en Imagen Estática ---
async function detectStaticImage(imgElement) {
    if (!objectDetector) return;
    
    // Detener cámara si está activa para evitar conflictos
    if (stream) stopCamera();

    log('Analizando imagen estática...', 'INFO');
    
    // Esperar a que la imagen cargue dimensiones si es necesario
    if (!imgElement.complete || imgElement.naturalWidth === 0) {
        await new Promise(resolve => imgElement.onload = resolve);
    }

    const predictionsRaw = await objectDetector.detect(imgElement);
    // Aplicar filtro de confianza
    const predictions = predictionsRaw.filter(p => p.score >= minConfidence);
    
    // Ajustar canvas a la imagen y cambiar modo CSS para alineación perfecta
    detectionCanvas.width = imgElement.naturalWidth;
    detectionCanvas.height = imgElement.naturalHeight;
    detectionCanvas.classList.remove('object-cover');
    detectionCanvas.classList.add('object-contain');
    
    // Limpiar y dibujar
    ctx.clearRect(0, 0, detectionCanvas.width, detectionCanvas.height);
    ctx.font = '16px sans-serif';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 4; // Línea más gruesa para fotos

    predictions.forEach(prediction => {
        const x = prediction.bbox[0];
        const y = prediction.bbox[1];
        const width = prediction.bbox[2];
        const height = prediction.bbox[3];
        const color = getColorForClass(prediction.class);

        ctx.strokeStyle = color;
        ctx.strokeRect(x, y, width, height);

        ctx.fillStyle = color;
        const translatedText = translate(prediction.class);
        const textWidth = ctx.measureText(translatedText).width;
        ctx.fillRect(x, y, textWidth + 4, 20);

        ctx.fillStyle = '#000000';
        ctx.fillText(translatedText, x, y);
    });

    updateResultsUI(predictions);
    log(`Detección completada. ${predictions.length} objetos encontrados.`, 'SUCCESS');
}

function toggleVoice() {
    isObjectListVoiceEnabled = !isObjectListVoiceEnabled; // Invertir estado
    if (isObjectListVoiceEnabled) {
        // Activar voz
        btnToggleVoice.classList.remove('bg-red-600', 'hover:bg-red-500');
        btnToggleVoice.classList.add('bg-green-600', 'hover:bg-green-500');
        iconVoiceOn.classList.remove('hidden');
        iconVoiceOff.classList.add('hidden');
        log('Voz de objetos activada.', 'INFO');
    } else {
        // Desactivar voz
        btnToggleVoice.classList.remove('bg-green-600', 'hover:bg-green-500');
        btnToggleVoice.classList.add('bg-red-600', 'hover:bg-red-500');
        iconVoiceOn.classList.add('hidden');
        iconVoiceOff.classList.remove('hidden');
        window.speechSynthesis.cancel(); // Detener cualquier locución en curso
        log('Voz de objetos desactivada. Las alertas de peligro seguirán sonando.', 'WARN');
    }
}

function toggleRoi() {
    isRoiActive = !isRoiActive;
    
    if (isRoiActive) {
        roiOverlay.classList.remove('hidden');
        // Cambiar estilo del botón a "Activo" (Rojo brillante)
        btnToggleRoi.classList.remove('bg-red-900/40', 'text-red-200', 'border-red-800/50');
        btnToggleRoi.classList.add('bg-red-600', 'text-white', 'border-red-500', 'shadow-[0_0_15px_rgba(220,38,38,0.5)]');
        log('Zona de peligro visible.', 'INFO');
    } else {
        roiOverlay.classList.add('hidden');
        // Restaurar estilo del botón
        btnToggleRoi.classList.add('bg-red-900/40', 'text-red-200', 'border-red-800/50');
        btnToggleRoi.classList.remove('bg-red-600', 'text-white', 'border-red-500', 'shadow-[0_0_15px_rgba(220,38,38,0.5)]');
        log('Zona de peligro oculta.', 'INFO');
    }
}

// --- Actualización de Indicador de Estado ---
function updateSystemStatus(isActive) {
    if (isActive) {
        statusDot.classList.replace('bg-red-500', 'bg-green-500');
        statusDot.classList.add('animate-pulse');
        statusText.innerText = "ONLINE";
        statusText.classList.replace('text-red-400', 'text-green-400');
    } else {
        statusDot.classList.replace('bg-green-500', 'bg-red-500');
        statusDot.classList.remove('animate-pulse');
        statusText.innerText = "OFFLINE";
        statusText.classList.replace('text-green-400', 'text-red-400');
    }
}

// --- Lógica de Interacción ROI (Drag & Resize) ---
function setupRoiInteractions() {
    if(!roiBox || !roiResize) return;

    // Mouse Events
    roiBox.addEventListener('mousedown', startDragRoi);
    roiResize.addEventListener('mousedown', startResizeRoi);
    document.addEventListener('mousemove', moveRoi);
    document.addEventListener('mouseup', stopRoiInteraction);

    // Touch Events (Móvil)
    roiBox.addEventListener('touchstart', startDragRoi, {passive: false});
    roiResize.addEventListener('touchstart', startResizeRoi, {passive: false});
    document.addEventListener('touchmove', moveRoi, {passive: false});
    document.addEventListener('touchend', stopRoiInteraction);
}

function startDragRoi(e) {
    // Si se toca el resize handle, no iniciar drag
    if (e.target.closest('#roi-resize') || isResizingRoi) return;
    
    e.preventDefault(); // Evitar scroll en móvil
    isDraggingRoi = true;
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    // Eliminar transform inicial para usar top/left absolutos
    if (roiBox.style.transform && roiBox.style.transform !== 'none') {
        const rect = roiBox.getBoundingClientRect();
        const parentRect = roiOverlay.getBoundingClientRect();
        roiBox.style.transform = 'none';
        roiBox.style.left = (rect.left - parentRect.left) + 'px';
        roiBox.style.top = (rect.top - parentRect.top) + 'px';
    }

    dragStartX = clientX;
    dragStartY = clientY;
    initialRoiLeft = parseFloat(roiBox.style.left) || roiBox.offsetLeft;
    initialRoiTop = parseFloat(roiBox.style.top) || roiBox.offsetTop;
}

function startResizeRoi(e) {
    e.preventDefault();
    e.stopPropagation(); // Detener propagación para no activar drag
    isResizingRoi = true;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    // Asegurar que usamos pixels absolutos antes de redimensionar
    if (roiBox.style.transform && roiBox.style.transform !== 'none') {
        const rect = roiBox.getBoundingClientRect();
        const parentRect = roiOverlay.getBoundingClientRect();
        roiBox.style.transform = 'none';
        roiBox.style.left = (rect.left - parentRect.left) + 'px';
        roiBox.style.top = (rect.top - parentRect.top) + 'px';
        roiBox.style.width = rect.width + 'px';
        roiBox.style.height = rect.height + 'px';
    }

    dragStartX = clientX;
    dragStartY = clientY;
    initialRoiW = roiBox.offsetWidth;
    initialRoiH = roiBox.offsetHeight;
}

function moveRoi(e) {
    if (!isDraggingRoi && !isResizingRoi) return;
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const deltaX = clientX - dragStartX;
    const deltaY = clientY - dragStartY;

    if (isDraggingRoi) {
        roiBox.style.left = (initialRoiLeft + deltaX) + 'px';
        roiBox.style.top = (initialRoiTop + deltaY) + 'px';
    } else if (isResizingRoi) {
        roiBox.style.width = Math.max(50, initialRoiW + deltaX) + 'px'; // Mínimo 50px
        roiBox.style.height = Math.max(50, initialRoiH + deltaY) + 'px';
    }
}

function stopRoiInteraction() {
    isDraggingRoi = false;
    isResizingRoi = false;
}

// --- Actualización de UI ---
function updateResultsUI(predictions, dangerDetected = false) {
    resultsArea.innerHTML = '';
    
    if (predictions.length === 0) {
        resultsArea.innerHTML = '<p class="text-slate-500 text-center italic">Escaneando...</p>';
        return;
    }

    // Filtrar duplicados manteniendo el objeto original para obtener su clase (y color)
    const uniquePredictions = [];
    const seen = new Set();
    predictions.forEach(p => {
        if (!seen.has(p.class)) {
            seen.add(p.class);
            uniquePredictions.push(p);
        }
    });

    // Lógica de Voz: Priorizar Alerta de Peligro
    if (dangerDetected) {
        speak("¡Alerta! Persona en zona de peligro.", 'alert');
    } else if (uniquePredictions.length > 0) {
        speak(uniquePredictions.map(p => translate(p.class)).join(', '), 'info');
    }
    
    uniquePredictions.forEach(p => {
        const color = getColorForClass(p.class);
        const translatedText = translate(p.class);
        
        const div = document.createElement('div');
        div.className = `bg-slate-900 border-l-4 p-3 rounded shadow-md mb-2 animate-pulse`;
        div.style.borderColor = color; // Borde del color del objeto
        div.innerHTML = `
            <h4 class="font-bold uppercase tracking-wider" style="color: ${color}">DETECTADO: ${translatedText}</h4>
        `;
        resultsArea.appendChild(div);
    });
}

// --- Diccionario de Traducción (COCO-SSD) ---
const translations = {
    'person': 'persona',
    'bicycle': 'bicicleta',
    'car': 'auto',
    'motorcycle': 'moto',
    'airplane': 'avión',
    'bus': 'autobús',
    'train': 'tren',
    'truck': 'camión',
    'boat': 'barco',
    'traffic light': 'semáforo',
    'fire hydrant': 'grifo',
    'stop sign': 'señal pare',
    'parking meter': 'parquímetro',
    'bench': 'banco',
    'bird': 'pájaro',
    'cat': 'gato',
    'dog': 'perro',
    'horse': 'caballo',
    'sheep': 'oveja',
    'cow': 'vaca',
    'elephant': 'elefante',
    'bear': 'oso',
    'zebra': 'cebra',
    'giraffe': 'jirafa',
    'backpack': 'mochila',
    'umbrella': 'paraguas',
    'handbag': 'bolso',
    'tie': 'corbata',
    'suitcase': 'maleta',
    'frisbee': 'frisbee',
    'skis': 'esquís',
    'snowboard': 'snowboard',
    'sports ball': 'pelota',
    'kite': 'cometa',
    'baseball bat': 'bate',
    'baseball glove': 'guante béisbol',
    'skateboard': 'skate',
    'surfboard': 'tabla surf',
    'tennis racket': 'raqueta',
    'bottle': 'botella',
    'wine glass': 'copa',
    'cup': 'taza',
    'fork': 'tenedor',
    'knife': 'cuchillo',
    'spoon': 'cuchara',
    'bowl': 'bol',
    'banana': 'plátano',
    'apple': 'manzana',
    'sandwich': 'sándwich',
    'orange': 'naranja',
    'broccoli': 'brócoli',
    'carrot': 'zanahoria',
    'hot dog': 'completo',
    'pizza': 'pizza',
    'donut': 'dona',
    'cake': 'pastel',
    'chair': 'silla',
    'couch': 'sofá',
    'potted plant': 'planta',
    'bed': 'cama',
    'dining table': 'mesa',
    'toilet': 'inodoro',
    'tv': 'tv',
    'laptop': 'portátil',
    'mouse': 'mouse',
    'remote': 'control remoto',
    'keyboard': 'teclado',
    'cell phone': 'celular',
    'microwave': 'microondas',
    'oven': 'horno',
    'toaster': 'tostadora',
    'sink': 'fregadero',
    'refrigerator': 'refrigerador',
    'book': 'libro',
    'clock': 'reloj',
    'vase': 'florero',
    'scissors': 'tijeras',
    'teddy bear': 'oso peluche',
    'hair drier': 'secador',
    'toothbrush': 'cepillo dientes'
};

function translate(text) {
    return translations[text] || text;
}

// --- Generador de Colores Dinámicos ---
function getColorForClass(className) {
    // Generar un hash único a partir del nombre de la clase
    let hash = 0;
    for (let i = 0; i < className.length; i++) {
        hash = className.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Usar el hash para definir el matiz (Hue) en HSL, manteniendo saturación y brillo altos
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 100%, 50%)`;
}

// --- Función de Texto a Voz (TTS) ---
function speak(text, type = 'info') {
    if (!window.speechSynthesis) return;

    // Si es una locución informativa (lista de objetos) y la voz está desactivada, no hablar.
    if (type === 'info' && !isObjectListVoiceEnabled) {
        return;
    }
    
    const now = Date.now();

    // Hablar solo si el texto cambia o han pasado 3 segundos (recordatorio)
    if (text !== lastSpokenText || (now - lastSpeechTime > 3000)) {
        // Cancelar cola anterior para evitar retrasos
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-ES'; // Español
        utterance.rate = 1.0;     // Velocidad
        
        window.speechSynthesis.speak(utterance);
        
        lastSpokenText = text;
        lastSpeechTime = now;
    }
}