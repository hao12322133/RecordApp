document.addEventListener('DOMContentLoaded', initializeApp);

function initializeApp() {
    // Constants
    const MAX_RECORDING_TIME = 10; // Maximum recording time in seconds

    // Video Configurations with adaptive quality
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

    // MIME Types with Priority and Fallbacks
    const MIME_TYPES = {
        PRIORITY: [
            'video/mp4;codecs=h264,aac',
            'video/mp4;codecs=avc1,mp4a.40.2',
            'video/mp4',
            'video/webm;codecs=h264,opus',
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm'
        ]
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

    // FFmpeg Instance
    let ffmpeg = null;

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
        isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
        canShare: !!(navigator.canShare && navigator.share)
    };

    // FFmpeg Initialization
    const initializeFFmpeg = async () => {
        if (!ffmpeg) {
            const { createFFmpeg } = window.FFmpeg;
            ffmpeg = createFFmpeg({ log: true });

            try {
                console.log('Loading FFmpeg...');
                await ffmpeg.load();
                console.log('FFmpeg loaded successfully.');
            } catch (error) {
                console.error('Failed to load FFmpeg:', error);
                throw error;
            }
        }
    };

    // Convert WebM to MP4 using FFmpeg with proper orientation and aspect ratio
    const convertToMP4 = async (webmBlob) => {
        try {
            await initializeFFmpeg();
            const { fetchFile } = FFmpeg;

            // Get video track settings
            const videoEl = document.createElement('video');
            videoEl.src = URL.createObjectURL(webmBlob);
            await new Promise((resolve) => {
                videoEl.onloadedmetadata = resolve;
            });

            const width = videoEl.videoWidth;
            const height = videoEl.videoHeight;
            URL.revokeObjectURL(videoEl.src);

            // Write input file to FFmpeg virtual filesystem
            ffmpeg.FS('writeFile', 'input.webm', await fetchFile(webmBlob));

            // Determine if we need to apply horizontal flip based on camera type
            const flipFilter = state.currentCamera === 'user' ? ',hflip' : '';

            // Run FFmpeg conversion with proper filtering
            await ffmpeg.run(
                '-i', 'input.webm',
                '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease${flipFilter}`,
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',        // Balance quality and file size
                '-c:a', 'aac',
                '-strict', 'experimental',
                '-movflags', '+faststart',  // Enable web playback optimization
                'output.mp4'
            );

            // Read the output file
            const mp4Data = ffmpeg.FS('readFile', 'output.mp4');

            // Create MP4 blob
            return new Blob([mp4Data.buffer], { type: 'video/mp4' });
        } catch (error) {
            console.error('Error converting video:', error);
            throw error;
        } finally {
            // Cleanup FFmpeg virtual filesystem
            try {
                ffmpeg.FS('unlink', 'input.webm');
                ffmpeg.FS('unlink', 'output.mp4');
            } catch (e) {
                console.warn('Cleanup error:', e);
            }
        }
    };

    // Utility Functions
    const utils = {
        isBrowserSupported() {
            return !!(
                navigator.mediaDevices &&
                navigator.mediaDevices.getUserMedia &&
                window.MediaRecorder &&
                document.createElement('video').canPlayType
            );
        },

        async stopTracks(stream) {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        }
    };

    // Timer Management
    const timer = {
        update() {
            const minutes = Math.floor(state.recordingDuration / 60);
            const seconds = state.recordingDuration % 60;
            elements.timerDisplay.textContent =
                `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
            if (state.recordingTimer) {
                clearInterval(state.recordingTimer);
                state.recordingTimer = null;
            }
        }
    };

    // Camera Management
    const camera = {
        async setup() {
            try {
                if (!utils.isBrowserSupported()) {
                    throw new Error('Browser not supported. Please use latest Chrome, Firefox, or Edge.');
                }

                await utils.stopTracks(state.stream);
                elements.previewVideo.srcObject = null;

                const videoConfig = state.isMobile ? VIDEO_CONFIG.MOBILE : VIDEO_CONFIG.DESKTOP;

                // Adaptive video configuration based on preview element
                const previewRatio = elements.previewVideo.offsetWidth / elements.previewVideo.offsetHeight;
                videoConfig.width = { ideal: elements.previewVideo.offsetWidth };
                videoConfig.height = { ideal: Math.floor(elements.previewVideo.offsetWidth / previewRatio) };

                const constraints = {
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        sampleRate: 44100
                    },
                    video: {
                        ...videoConfig,
                        facingMode: { exact: state.currentCamera }
                    }
                };

                try {
                    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
                } catch (exactError) {
                    console.warn('Exact constraint failed, trying without exact:', exactError);
                    constraints.video.facingMode = state.currentCamera;
                    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
                }

                if (!state.stream.getVideoTracks().length) {
                    throw new Error('No video track available');
                }

                elements.previewVideo.srcObject = state.stream;
                elements.previewVideo.style.transform = state.currentCamera === 'user' ? 'scaleX(-1)' : 'none';
                await elements.previewVideo.play();

                ui.updateStatus('Camera ready');
                ui.enableButtons();
            } catch (err) {
                console.error('Camera setup failed:', err);
                ui.updateStatus(`Camera Error: ${err.message}`);
                ui.disableButtons();
            }
        },

        async switch() {
            if (state.isRecording) return;

            try {
                await utils.stopTracks(state.stream);
                state.currentCamera = state.currentCamera === 'user' ? 'environment' : 'user';
                await this.setup();
            } catch (error) {
                console.error('Camera switch failed:', error);
                ui.updateStatus(`Switch camera error: ${error.message}`);

                // Try reverting to previous camera
                if (state.currentCamera === 'environment') {
                    state.currentCamera = 'user';
                    await this.setup();
                }
            }
        }
    };

    // Recording Management
    const recording = {
        videoProcessor: null,

        async setupVideoProcessor() {
            const videoTrack = state.stream.getVideoTracks()[0];
            const { width, height } = videoTrack.getSettings();

            // Create processing canvas with correct dimensions
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = width;
            canvas.height = height;

            // Create a video element for processing
            const videoEl = document.createElement('video');
            videoEl.autoplay = true;
            videoEl.muted = true;
            videoEl.srcObject = state.stream;
            await videoEl.play();

            // Setup canvas processor
            this.videoProcessor = {
                canvas,
                ctx,
                videoEl,
                width,
                height,
                process: () => {
                    ctx.save();

                    // Clear canvas
                    ctx.clearRect(0, 0, canvas.width, canvas.height);

                    // Handle mirroring based on camera type
                    if (state.currentCamera === 'user') {
                        ctx.scale(-1, 1);
                        ctx.translate(-canvas.width, 0);
                    }

                    // Draw video frame
                    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

                    ctx.restore();
                }
            };
        },

        async start() {
            try {
                state.recordedChunks = [];
                state.recordedBlob = null;
                ui.disableDownloadShare();

                // Get video track constraints
                const videoTrack = state.stream.getVideoTracks()[0];
                const { width, height } = videoTrack.getSettings();
                console.log('Video settings:', { width, height });

                const mimeType = MIME_TYPES.PRIORITY.find(type => MediaRecorder.isTypeSupported(type));
                if (!mimeType) {
                    throw new Error('No supported video format found');
                }

                const options = {
                    mimeType,
                    videoBitsPerSecond: 2500000,
                    audioBitsPerSecond: 128000
                };

                // Use original stream for recording
                state.mediaRecorder = new MediaRecorder(state.stream, options);

                state.mediaRecorder.ondataavailable = (event) => {
                    if (event.data && event.data.size > 0) {
                        state.recordedChunks.push(event.data);
                    }
                };

                state.mediaRecorder.onstop = async () => {
                    try {
                        // First create WebM blob from recorded chunks
                        const webmBlob = new Blob(state.recordedChunks, { type: 'video/webm' });

                        // Update status to show conversion progress
                        ui.updateStatus('Converting video format...');

                        // Convert WebM to MP4
                        state.recordedBlob = await convertToMP4(webmBlob);

                        ui.enableDownloadShare();
                        ui.updateStatus('Video ready for download or share');
                    } catch (error) {
                        console.error('Video processing error:', error);
                        ui.updateStatus(`Video processing error: ${error.message}`);
                    }
                };

                // Start recording and canvas processing
                state.mediaRecorder.start(1000);

                // Start canvas processing loop
                const processFrame = () => {
                    if (state.isRecording) {
                        this.videoProcessor.process();
                        requestAnimationFrame(processFrame);
                    }
                };
                processFrame();

                timer.start();
                state.isRecording = true;
                ui.updateRecordingState();
                ui.updateStatus('Recording... (max 10 seconds)');

            } catch (err) {
                console.error('Recording start failed:', err);
                ui.updateStatus(`Error: ${err.message}`);
            }
        },

        stop() {
            if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
                state.mediaRecorder.stop();
                timer.stop();
                state.isRecording = false;
                ui.updateRecordingState();
                ui.updateStatus('Processing video...');

                // Cleanup video processor
                if (this.videoProcessor) {
                    this.videoProcessor.videoEl.srcObject = null;
                    this.videoProcessor = null;
                }
            }
        }
    };

    // UI Management
    const ui = {
        initialize() {
            elements.switchCameraButton.style.display = state.isMobile ? 'block' : 'none';
            elements.shareButton.style.display = state.canShare ? 'block' : 'none';
            this.disableDownloadShare();
        },

        updateStatus(message) {
            elements.statusMessage.textContent = message;
        },

        updateRecordingState() {
            elements.startRecordingButton.textContent = state.isRecording ? 'Stop Recording' : 'Start Recording';
            elements.switchCameraButton.disabled = state.isRecording;
        },

        enableButtons() {
            elements.startRecordingButton.disabled = false;
            elements.switchCameraButton.disabled = false;
        },

        disableButtons() {
            elements.startRecordingButton.disabled = true;
            elements.switchCameraButton.disabled = true;
        },

        enableDownloadShare() {
            elements.downloadButton.disabled = false;
            elements.shareButton.disabled = !state.canShare;
        },

        disableDownloadShare() {
            elements.downloadButton.disabled = true;
            elements.shareButton.disabled = true;
        }
    };

    // Video Export
    const videoExport = {
        download() {
            if (state.recordedBlob) {
                const url = URL.createObjectURL(state.recordedBlob);
                const a = document.createElement('a');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                a.href = url;
                a.download = `video-${timestamp}.mp4`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);
            }
        },

        async share() {
            if (!state.recordedBlob || !state.canShare) return;

            try {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const file = new File([state.recordedBlob], `video-${timestamp}.mp4`, {
                    type: 'video/mp4'
                });

                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Recorded Video',
                        text: 'Video recorded from web app'
                    });
                    ui.updateStatus('Video shared successfully');
                } else {
                    ui.updateStatus('Device does not support file sharing');
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    ui.updateStatus('Sharing cancelled');
                } else {
                    console.error('Share failed:', error);
                    ui.updateStatus(`Share error: ${error.message}`);
                }
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

    elements.switchCameraButton.addEventListener('click', () => camera.switch());
    elements.downloadButton.addEventListener('click', () => videoExport.download());
    elements.shareButton.addEventListener('click', () => videoExport.share());

    // Initialize Application
    (async () => {
        try {
            await initializeFFmpeg();
            ui.initialize();
            await camera.setup();
        } catch (error) {
            console.error('Initialization error:', error);
            ui.updateStatus(`Initialization error: ${error.message}`);
        }
    })();
}