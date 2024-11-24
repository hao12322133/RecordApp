// Constants
const MAX_RECORDING_TIME = 10; // Maximum recording time in seconds

// Video Configurations
const VIDEO_CONFIG = {
    MOBILE: {
        width: { ideal: 960 },
        height: { ideal: 540 },
        frameRate: { ideal: 30 }
    },
    DESKTOP: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
    }
};

// MIME Types with Priority
const MIME_TYPES = {
    MOBILE: [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/webm;codecs=h264,opus',
        'video/webm;codecs=vp8,opus'
    ],
    DESKTOP: [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/webm;codecs=h264,opus',
        'video/webm;codecs=vp9,opus'
    ]
};

// State Management
const state = {
    stream: null,
    mediaRecorder: null,
    recordedChunks: [],
    isRecording: false,
    currentCamera: 'user',
    recordingTimer: null,
    recordingDuration: 0,
    recordedBlob: null,
    canvas: null,
    context: null,
    animationFrame: null,
    videoOffset: null
};

// DOM Elements
const elements = {
    previewVideo: document.getElementById('previewVideo'),
    startRecordingButton: document.getElementById('startRecordingButton'),
    switchCameraButton: document.getElementById('switchCameraButton'),
    downloadButton: document.getElementById('downloadButton'),
    shareButton: document.getElementById('shareButton'),
    statusMessage: document.getElementById('statusMessage'),
    timerDisplay: document.getElementById('timerDisplay')
};

// Device Info
const deviceInfo = {
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    canShare: navigator.canShare && navigator.share,
    isBrowserSupported: () => !!(
        navigator.mediaDevices &&
        navigator.mediaDevices.getUserMedia &&
        window.MediaRecorder &&
        document.createElement('video').canPlayType
    )
};

// Timer
const timer = {
    update() {
        const minutes = Math.floor(state.recordingDuration / 60);
        const seconds = state.recordingDuration % 60;
        elements.timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    },
    start() {
        state.recordingDuration = 0;
        this.update();
        state.recordingTimer = setInterval(() => {
            state.recordingDuration++;
            this.update();
            if (state.recordingDuration >= MAX_RECORDING_TIME) {
                recording.stop();
            }
        }, 1000);
    },
    stop() {
        clearInterval(state.recordingTimer);
        state.recordingTimer = null;
    }
};

// UI Updates
const ui = {
    initialize() {
        elements.switchCameraButton.style.display = deviceInfo.isMobile ? 'inline-block' : 'none';
        elements.shareButton.style.display = deviceInfo.canShare ? 'inline-block' : 'none';
        elements.downloadButton.disabled = true;
        elements.shareButton.disabled = true;
    },
    updateStatus(message) {
        elements.statusMessage.textContent = message;
    },
    toggleRecordingUI(isRecording) {
        elements.startRecordingButton.textContent = isRecording ? 'Stop Recording' : 'Start Recording';
        elements.switchCameraButton.disabled = isRecording;
        ui.updateStatus(isRecording ? 'Recording... (up to 10 seconds)' : 'Ready');
    },
    enableDownloadAndShare() {
        elements.downloadButton.disabled = false;
        elements.shareButton.disabled = !deviceInfo.canShare;
    }
};

// Camera & Stream Management
const camera = {
    async setup() {
        try {
            const constraints = {
                audio: { echoCancellation: true, noiseSuppression: true },
                video: {
                    ...deviceInfo.isMobile ? VIDEO_CONFIG.MOBILE : VIDEO_CONFIG.DESKTOP,
                    facingMode: state.currentCamera
                }
            };
            state.stream = await navigator.mediaDevices.getUserMedia(constraints);
            elements.previewVideo.srcObject = state.stream;

            elements.previewVideo.style.transform = state.currentCamera === 'user' ? 'scaleX(-1)' : 'none';
            await elements.previewVideo.play();

            this.setupCanvas();
            ui.updateStatus('Camera Ready');
        } catch (err) {
            console.error('Camera setup failed:', err);
            ui.updateStatus('Error initializing camera');
        }
    },
    setupCanvas() {
        const videoTrack = state.stream.getVideoTracks()[0];
        const { width: videoWidth, height: videoHeight } = videoTrack.getSettings();

        const aspectRatio = 9 / 16;
        let canvasWidth, canvasHeight;

        if (videoWidth / videoHeight > aspectRatio) {
            canvasHeight = videoHeight;
            canvasWidth = videoHeight * aspectRatio;
        } else {
            canvasWidth = videoWidth;
            canvasHeight = videoWidth / aspectRatio;
        }

        state.canvas = document.createElement('canvas');
        state.canvas.width = canvasWidth;
        state.canvas.height = canvasHeight;
        state.context = state.canvas.getContext('2d');

        state.videoOffset = {
            x: (videoWidth - canvasWidth) / 2,
            y: (videoHeight - canvasHeight) / 2,
            width: canvasWidth,
            height: canvasHeight
        };
    },
    async switch() {
        state.currentCamera = state.currentCamera === 'user' ? 'environment' : 'user';
        await this.setup();
    },
    async stop() {
        if (state.stream) {
            state.stream.getTracks().forEach(track => track.stop());
            state.stream = null;
        }
        elements.previewVideo.srcObject = null;
    }
};
const recording = {
    async start() {
        if (state.isRecording) return;
        try {
            const options = this.getOptions();
            state.recordedChunks = [];

            const fps = 30;
            const canvasStream = state.canvas.captureStream(fps);

            // Clone audio track để tránh conflict
            const audioTrack = state.stream.getAudioTracks()[0];
            if (audioTrack) {
                const clonedAudioTrack = audioTrack.clone();
                canvasStream.addTrack(clonedAudioTrack);
            }

            state.mediaRecorder = new MediaRecorder(canvasStream, options);
            let frameCount = 0;
            let lastFrameTime = performance.now();
            const frameInterval = 1000 / fps;

            // Sử dụng requestVideoFrameCallback nếu có hỗ trợ
            if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
                const processVideoFrame = () => {
                    if (!state.isRecording) return;
                    frameCount++;
                    elements.previewVideo.requestVideoFrameCallback(processVideoFrame);
                };
                elements.previewVideo.requestVideoFrameCallback(processVideoFrame);
            }

            const drawFrame = (timestamp) => {
                if (!state.isRecording) return;

                const elapsed = timestamp - lastFrameTime;

                if (elapsed >= frameInterval) {
                    state.context.save();

                    // Clear canvas trước khi vẽ frame mới
                    state.context.clearRect(0, 0, state.canvas.width, state.canvas.height);

                    if (state.currentCamera === 'user') {
                        state.context.scale(-1, 1);
                        state.context.translate(-state.canvas.width, 0);
                    }

                    // Đảm bảo preview video đã sẵn sàng
                    if (elements.previewVideo.readyState >= 2) {
                        state.context.drawImage(
                            elements.previewVideo,
                            state.videoOffset.x,
                            state.videoOffset.y,
                            state.videoOffset.width,
                            state.videoOffset.height,
                            0,
                            0,
                            state.canvas.width,
                            state.canvas.height
                        );
                    }

                    state.context.restore();
                    lastFrameTime = timestamp;
                }

                state.animationFrame = requestAnimationFrame(drawFrame);
            };

            // Buffer để xử lý chunks
            let chunksBuffer = [];
            const processChunk = async (chunk) => {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(new Blob([reader.result], { type: chunk.type }));
                    reader.readAsArrayBuffer(chunk);
                });
            };

            state.mediaRecorder.ondataavailable = async (e) => {
                if (e.data && e.data.size > 0) {
                    // Xử lý chunk và thêm vào buffer
                    const processedChunk = await processChunk(e.data);
                    chunksBuffer.push(processedChunk);
                }
            };

            state.mediaRecorder.onstop = async () => {
                // Đợi tất cả chunks được xử lý
                state.recordedChunks = chunksBuffer;
                this.processRecording();
            };

            state.animationFrame = requestAnimationFrame(drawFrame);

            // Điều chỉnh chunk interval và đảm bảo codec
            state.mediaRecorder.start(150); // 150ms chunk interval

            state.isRecording = true;
            ui.toggleRecordingUI(true);
            timer.start();

        } catch (err) {
            console.error('Recording failed:', err);
            ui.updateStatus('Error starting recording');
        }
    },

    stop() {
        if (!state.isRecording) return;
        state.isRecording = false;

        if (state.animationFrame) {
            cancelAnimationFrame(state.animationFrame);
        }

        if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
            state.mediaRecorder.stop();
        }

        timer.stop();
        ui.toggleRecordingUI(false);
    },

    getOptions() {
        const mimeTypes = deviceInfo.isMobile ? MIME_TYPES.MOBILE : MIME_TYPES.DESKTOP;
        const selectedType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));

        return {
            mimeType: selectedType || 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
            videoBitsPerSecond: 3000000,  // Tăng bitrate để đảm bảo chất lượng
            audioBitsPerSecond: 128000
        };
    },

    processRecording() {
        if (state.recordedChunks.length > 0) {
            try {
                // Đảm bảo sử dụng đúng codec cho MP4
                state.recordedBlob = new Blob(state.recordedChunks, {
                    type: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2'
                });

                if (state.recordedBlob.size > 0) {
                    console.log('Recording processed successfully:', {
                        size: state.recordedBlob.size,
                        type: state.recordedBlob.type,
                        chunks: state.recordedChunks.length
                    });
                    ui.enableDownloadAndShare();
                    ui.updateStatus('Recording complete. Ready to download or share.');
                }
            } catch (error) {
                console.error('Error processing recording:', error);
                ui.updateStatus('Error processing recording');
            }
        }
    }
};
const videoExport = {
    download() {
        if (!state.recordedBlob) return;
        try {
            const url = URL.createObjectURL(state.recordedBlob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `recording-${Date.now()}.mp4`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            // Tăng thời gian chờ để đảm bảo file được tải về hoàn chỉnh
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 500);
        } catch (error) {
            console.error('Download failed:', error);
            ui.updateStatus('Error downloading video');
        }
    },
    async share() {
        if (!state.recordedBlob || !deviceInfo.canShare) return;
        const file = new File([state.recordedBlob], `recording-${Date.now()}.mp4`, {
            type: state.recordedBlob.type
        });
        try {
            await navigator.share({ files: [file] });
            ui.updateStatus('Video shared successfully!');
        } catch (err) {
            console.error('Sharing failed:', err);
            ui.updateStatus('Error sharing video');
        }
    }
};

// Event Listeners
elements.startRecordingButton.addEventListener('click', () => {
    if (state.isRecording) {
        recording.stop();
    } else {
        recording.start();
    }
});
elements.switchCameraButton.addEventListener('click', camera.switch.bind(camera));
elements.downloadButton.addEventListener('click', videoExport.download.bind(videoExport));
elements.shareButton.addEventListener('click', videoExport.share.bind(videoExport));

// Initialization
(async () => {
    if (!deviceInfo.isBrowserSupported()) {
        alert('Your browser does not support required features for recording.');
        return;
    }
    ui.initialize();
    await camera.setup();
})();
