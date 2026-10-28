// BodyPose model (ml5.js v1)
let bodyPose;
let video;
let bgVideo; // Background video
let bgMusic; // Background music (loops)
let poses = [];

// Scene management - each detected person gets a different scene's assets
let scenes = [];

// Puppet images (8 parts)
// Parts: head, torso, leftArm, rightArm, leftForearm, rightForearm, leftLeg, rightLeg
let puppetParts = [];

// Assets
let backgrounds = [];
let musicTracks = [];

// Scene data structure
// Each scene has: background, 8 puppet parts, music track
const NUM_SCENES = 3; // You can increase this
const NUM_PUPPET_PARTS = 11;

// Set to true once you've added your assets to enable loading
const LOAD_CUSTOM_ASSETS = true;

// Key point names for BodyPose (ml5.js v1)
// BodyPose returns keypoints with names, not indices
const keyPointNames = {
    nose: 'nose',
    leftEye: 'leftEye',
    rightEye: 'rightEye',
    leftEar: 'leftEar',
    rightEar: 'rightEar',
    leftShoulder: 'leftShoulder',
    rightShoulder: 'rightShoulder',
    leftElbow: 'leftElbow',
    rightElbow: 'rightElbow',
    leftWrist: 'leftWrist',
    rightWrist: 'rightWrist',
    leftHip: 'leftHip',
    rightHip: 'rightHip',
    leftKnee: 'leftKnee',
    rightKnee: 'rightKnee',
    leftAnkle: 'leftAnkle',
    rightAnkle: 'rightAnkle'
};

// Pose tracking - maintain consistent scene assignments
let trackedPeople = []; // Array of { id, sceneIndex, lastPosition, framesSinceSeen }
let nextPersonId = 0;
const MAX_TRACKING_DISTANCE = 150; // Max pixels to match a pose to a tracked person
const MAX_FRAMES_MISSING = 30; // Frames before removing a tracked person

// Use browser image elements instead of p5.loadImage(), which fetches files
// and is blocked for file:// pages. These images are only drawn, never read back.
function loadPuppetImage(path) {
    return new Promise((resolve, reject) => {
        const source = new Image();
        source.onload = () => {
            try {
                const img = createImage(source.naturalWidth, source.naturalHeight);
                img.drawingContext.drawImage(source, 0, 0);
                resolve(img);
            } catch (error) {
                reject(error);
            }
        };
        source.onerror = () => reject(new Error(`Could not load ${path}`));
        source.src = path;
    });
}

async function loadPuppetImages() {
    const filenames = {
        skull: 'skull.png',
        chest: 'chest.png',
        hips: 'hips.png',
        armUpperRight: 'arm_upper_right.png',
        armMidRight: 'arm_mid_right.png',
        legUpperLeft: 'leg_upper_left.png',
        legLowerLeft: 'leg_lower_left.png'
    };
    const pending = [];
    for (let i = 0; i < NUM_SCENES; i++) {
        scenes[i] = { puppetParts: [], rawImages: {} };
        if (!LOAD_CUSTOM_ASSETS) continue;
        for (const [part, filename] of Object.entries(filenames)) {
            pending.push(loadPuppetImage(`assets/scene${i}/${filename}`)
                .then(img => { scenes[i].rawImages[part] = img; })
                .catch(error => { console.warn(error.message); }));
        }
    }
    await Promise.all(pending);
    processPuppetImages();
    initializeScenes();
}

function setup() {
    const cnv = createCanvas(windowWidth, windowHeight);
    cnv.parent('canvas-container');
    background(0);

    // p5 adds crossorigin="anonymous" to media, which blocks local videos.
    // Remove it before assigning the source so normal file loading is used.
    bgVideo = createVideo([]);
    bgVideo.hide();
    bgVideo.elt.removeAttribute('crossorigin');
    bgVideo.elt.muted = true;
    bgVideo.elt.loop = true;
    bgVideo.elt.autoplay = true;
    bgVideo.elt.playsInline = true;
    bgVideo.elt.src = 'assets/video.mp4';
    bgVideo.elt.play().catch(() => { /* Retried by the Start button. */ });

    // Native audio can play local files without p5.sound's HTTP loader.
    bgMusic = new Audio('assets/music.mp3');
    bgMusic.loop = true;
    bgMusic.preload = 'auto';

    const button = document.getElementById('start-button');
    button.addEventListener('click', startExperience);
    loadPuppetImages().then(() => {
        button.disabled = false;
        button.textContent = 'Start';
    }).catch(error => {
        console.error('Could not prepare puppet images:', error);
        document.getElementById('startup-status').textContent =
            'Could not prepare the puppets. Keep the assets folder beside index.html and reload.';
    });

    window.addEventListener('pagehide', () => {
        if (bodyPose) bodyPose.detectStop();
        stopCamera();
        bgMusic.pause();
        bgVideo.elt.pause();
    });
}

function stopCamera() {
    if (video && video.elt.srcObject) {
        video.elt.srcObject.getTracks().forEach(track => track.stop());
        video.elt.srcObject = null;
    }
}

async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is unavailable. Open index.html in Chrome or Firefox and allow camera access.');
    }
    if (!video) {
        video = createVideo([]);
        video.size(width, height);
        video.hide();
        video.elt.muted = true;
        video.elt.playsInline = true;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    try {
        await new Promise((resolve, reject) => {
            const cleanup = () => {
                video.elt.removeEventListener('loadeddata', ready);
                video.elt.removeEventListener('error', failed);
            };
            const ready = () => { cleanup(); resolve(); };
            const failed = () => { cleanup(); reject(new Error('The camera could not start.')); };
            video.elt.addEventListener('loadeddata', ready);
            video.elt.addEventListener('error', failed);
            video.elt.srcObject = stream;
            video.elt.play().catch(error => { cleanup(); reject(error); });
        });
    } catch (error) {
        stopCamera();
        throw error;
    }
}

async function initBodyPose() {
    if (typeof ml5 === 'undefined') {
        throw new Error('Pose tracking could not load. Keep ml5.min.js beside index.html and reload.');
    }
    try {
        bodyPose = ml5.bodyPose();
        // The model object is returned immediately; its ready promise resolves
        // only after the remote model and its weights have finished loading.
        await bodyPose.ready;
    } catch (error) {
        bodyPose = null;
        console.error('Could not load BodyPose:', error);
        throw new Error('Could not load pose tracking. Check your internet connection, then try again.');
    }
    bodyPose.detectStart(video, gotPoses);
}

async function startExperience() {
    const button = document.getElementById('start-button');
    const status = document.getElementById('startup-status');
    button.disabled = true;
    button.textContent = 'Starting…';
    status.textContent = 'Allow camera access when prompted…';

    // Start audio during the click, before awaiting camera or model loading.
    bgMusic.play().catch(error => { console.warn('Music could not start:', error); });
    bgVideo.elt.play().catch(error => { console.warn('Background video could not start:', error); });
    try {
        await startCamera();
        status.textContent = 'Loading pose tracking…';
        await initBodyPose();
        document.getElementById('startup').hidden = true;
    } catch (error) {
        console.error('Could not start:', error);
        stopCamera();
        bgMusic.pause();
        const cameraErrors = {
            NotAllowedError: 'Camera access was blocked. Allow the camera in your browser settings, then try again.',
            NotFoundError: 'No camera was found. Connect a webcam, then try again.',
            NotReadableError: 'The camera is unavailable. Close other apps using it, then try again.'
        };
        status.textContent = cameraErrors[error.name] || error.message;
        button.disabled = false;
        button.textContent = 'Try again';
    }
}

// Function to flip an image horizontally
function flipImageHorizontal(img) {
    if (!img || !img.width || !img.height) return null;
    
    let flipped = createGraphics(img.width, img.height);
    flipped.push();
    flipped.translate(img.width, 0);
    flipped.scale(-1, 1);
    flipped.image(img, 0, 0);
    flipped.pop();
    return flipped;
}

// Function to flip an image vertically (top to bottom)
function flipImageVertical(img) {
    if (!img || !img.width || !img.height) return null;
    
    let flipped = createGraphics(img.width, img.height);
    flipped.push();
    flipped.translate(0, img.height);
    flipped.scale(1, -1);
    flipped.image(img, 0, 0);
    flipped.pop();
    return flipped;
}

function processPuppetImages() {
    // Process images for each scene
    for (let i = 0; i < NUM_SCENES; i++) {
        if (!scenes[i].rawImages) continue;
        
        const raw = scenes[i].rawImages;
        
        // Map puppet parts:
        // part0: skull (head)
        // part1: chest (torso)
        // part2: hips (waist/hip area)
        // part3: arm_upper_right flipped (left upper arm)
        // part4: arm_upper_right (right upper arm)
        // part5: arm_mid_right flipped (left forearm)
        // part6: arm_mid_right (right forearm)
        // part7: leg_upper_left (left upper leg)
        // part8: leg_upper_left flipped (right upper leg)
        // part9: leg_lower_left (left lower leg)
        // part10: leg_lower_left flipped (right lower leg)
        
        // Check if images exist and are loaded before using them
        if (raw.skull && raw.skull.width > 0) {
            scenes[i].puppetParts[0] = raw.skull;
        }
        
        if (raw.chest && raw.chest.width > 0) {
            scenes[i].puppetParts[1] = raw.chest;
        }
        
        if (raw.hips && raw.hips.width > 0) {
            scenes[i].puppetParts[2] = raw.hips;
        }
        
        // Create flipped versions for left side from right images (vertical flip - opposite of horizontal)
        if (raw.armUpperRight && raw.armUpperRight.width > 0) {
            scenes[i].puppetParts[3] = flipImageVertical(raw.armUpperRight); // Left upper arm
            scenes[i].puppetParts[4] = raw.armUpperRight; // Right upper arm
        }
        
        if (raw.armMidRight && raw.armMidRight.width > 0) {
            scenes[i].puppetParts[5] = flipImageVertical(raw.armMidRight); // Left forearm
            scenes[i].puppetParts[6] = raw.armMidRight; // Right forearm
        }
        
        // Use left images for right side (vertical flip - opposite of horizontal)
        if (raw.legUpperLeft && raw.legUpperLeft.width > 0) {
            scenes[i].puppetParts[7] = raw.legUpperLeft; // Left upper leg
            scenes[i].puppetParts[8] = flipImageVertical(raw.legUpperLeft); // Right upper leg
        }
        
        if (raw.legLowerLeft && raw.legLowerLeft.width > 0) {
            scenes[i].puppetParts[9] = raw.legLowerLeft; // Left lower leg
            scenes[i].puppetParts[10] = flipImageVertical(raw.legLowerLeft); // Right lower leg
        }
    }
}

// Get the center position of a pose (average of key visible points)
function getPoseCenter(pose) {
    if (!pose) return null;
    
    const getKp = (name) => findKeypoint(pose, name);
    const nose = getKp('nose');
    const leftShoulder = getKp('leftShoulder');
    const rightShoulder = getKp('rightShoulder');
    const leftHip = getKp('leftHip');
    const rightHip = getKp('rightHip');
    
    let sumX = 0, sumY = 0, count = 0;
    
    if (nose && nose.x !== undefined) {
        sumX += nose.x;
        sumY += nose.y;
        count++;
    }
    if (leftShoulder && leftShoulder.x !== undefined) {
        sumX += leftShoulder.x;
        sumY += leftShoulder.y;
        count++;
    }
    if (rightShoulder && rightShoulder.x !== undefined) {
        sumX += rightShoulder.x;
        sumY += rightShoulder.y;
        count++;
    }
    if (leftHip && leftHip.x !== undefined) {
        sumX += leftHip.x;
        sumY += leftHip.y;
        count++;
    }
    if (rightHip && rightHip.x !== undefined) {
        sumX += rightHip.x;
        sumY += rightHip.y;
        count++;
    }
    
    if (count === 0) return null;
    return { x: sumX / count, y: sumY / count };
}

// Find the closest tracked person to a pose position
function findClosestTrackedPerson(position) {
    if (!position || trackedPeople.length === 0) return null;
    
    let closest = null;
    let minDistance = MAX_TRACKING_DISTANCE;
    
    for (let i = 0; i < trackedPeople.length; i++) {
        const tracked = trackedPeople[i];
        if (!tracked.lastPosition) continue;
        
        const distance = dist(
            position.x, position.y,
            tracked.lastPosition.x, tracked.lastPosition.y
        );
        
        if (distance < minDistance) {
            minDistance = distance;
            closest = { index: i, distance: distance };
        }
    }
    
    return closest;
}

function gotPoses(results) {
    // ml5.js v1 bodyPose returns results
    // Check different possible formats
    let rawPoses = [];
    
    if (!results) {
        // Increment frames since last seen for all tracked people
        trackedPeople.forEach(person => {
            person.framesSinceSeen++;
        });
        poses = [];
        return;
    }
    
    if (Array.isArray(results)) {
        // Array of poses
        rawPoses = results.map(result => ({ pose: result }));
    } else if (results.pose) {
        // Wrapped in pose property
        rawPoses = [{ pose: results.pose }];
    } else if (results.keypoints) {
        // Single pose object with keypoints
        rawPoses = [{ pose: results }];
    } else {
        // Try as single pose
        rawPoses = [{ pose: results }];
    }
    
    // Track poses and maintain consistent scene assignments
    // Mark all tracked people as potentially missing
    trackedPeople.forEach(person => {
        person.matched = false;
    });
    
    // Match each detected pose to a tracked person or create new
    poses = rawPoses.map(detectedPose => {
        const center = getPoseCenter(detectedPose.pose);
        if (!center) {
            return { ...detectedPose, personId: null, sceneIndex: 0 };
        }
        
        // Find closest tracked person
        const match = findClosestTrackedPerson(center);
        
        if (match && trackedPeople[match.index]) {
            // Update existing tracked person
            const tracked = trackedPeople[match.index];
            tracked.lastPosition = center;
            tracked.framesSinceSeen = 0;
            tracked.matched = true;
            return {
                ...detectedPose,
                personId: tracked.id,
                sceneIndex: tracked.sceneIndex
            };
        } else {
            // Create new tracked person
            const sceneIndex = nextPersonId % NUM_SCENES;
            const newPerson = {
                id: nextPersonId++,
                sceneIndex: sceneIndex,
                lastPosition: center,
                framesSinceSeen: 0,
                matched: true
            };
            trackedPeople.push(newPerson);
            return {
                ...detectedPose,
                personId: newPerson.id,
                sceneIndex: newPerson.sceneIndex
            };
        }
    });
    
    // Remove tracked people who haven't been seen for too long
    trackedPeople = trackedPeople.filter(person => {
        if (!person.matched) {
            person.framesSinceSeen++;
        }
        return person.framesSinceSeen < MAX_FRAMES_MISSING;
    });
}

function initializeScenes() {
    // Initialize default puppet parts as colored rectangles (replace with actual images)
    for (let i = 0; i < NUM_SCENES; i++) {
        for (let j = 0; j < NUM_PUPPET_PARTS; j++) {
            if (!scenes[i].puppetParts[j]) {
                scenes[i].puppetParts[j] = createGraphics(100, 100);
                // Hide the graphics canvas element if it exists
                if (scenes[i].puppetParts[j].canvas) {
                    scenes[i].puppetParts[j].canvas.style.display = 'none';
                }
                scenes[i].puppetParts[j].fill(150 + j * 15, 100 + j * 10, 200);
                scenes[i].puppetParts[j].rect(0, 0, 100, 100);
                scenes[i].puppetParts[j].fill(255);
                scenes[i].puppetParts[j].textAlign(CENTER, CENTER);
                scenes[i].puppetParts[j].text(`Scene${i}\nPart${j}`, 50, 50);
            }
        }
    }
}

// Each person automatically gets assigned a scene based on their detection order
// Person 0 -> scene0, Person 1 -> scene1, Person 2 -> scene2, etc. (wraps around)

// Helper function to find keypoint by name
// ml5 v1 bodyPose has both keypoints array and named properties (with underscores)
function findKeypoint(pose, name) {
    if (!pose) return null;
    
    // Map camelCase to snake_case for ml5 v1 property names
    const nameMap = {
        'nose': 'nose',
        'leftEye': 'left_eye',
        'rightEye': 'right_eye',
        'leftEar': 'left_ear',
        'rightEar': 'right_ear',
        'leftShoulder': 'left_shoulder',
        'rightShoulder': 'right_shoulder',
        'leftElbow': 'left_elbow',
        'rightElbow': 'right_elbow',
        'leftWrist': 'left_wrist',
        'rightWrist': 'right_wrist',
        'leftHip': 'left_hip',
        'rightHip': 'right_hip',
        'leftKnee': 'left_knee',
        'rightKnee': 'right_knee',
        'leftAnkle': 'left_ankle',
        'rightAnkle': 'right_ankle'
    };
    
    const snakeName = nameMap[name] || name;
    
    // Try named property first (e.g., pose.left_shoulder)
    if (pose[snakeName] && pose[snakeName].x !== undefined) {
        return pose[snakeName];
    }
    
    // Try keypoints array
    if (pose.keypoints && Array.isArray(pose.keypoints)) {
        return pose.keypoints.find(kp => 
            kp.name === snakeName || 
            kp.name === name ||
            (kp.name && kp.name.toLowerCase() === snakeName.toLowerCase())
        );
    }
    
    return null;
}

// Draw skeleton bones for debugging
function drawSkeleton(pose) {
    if (!pose) return;
    
    const getKp = (name) => findKeypoint(pose, name);
    
    stroke(0, 255, 0);
    strokeWeight(3);
    noFill();
    
    // Draw connections
    const connections = [
        ['nose', 'left_eye'], ['nose', 'right_eye'],
        ['left_eye', 'left_ear'], ['right_eye', 'right_ear'],
        ['left_shoulder', 'right_shoulder'],
        ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
        ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
        ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
        ['left_hip', 'right_hip'],
        ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
        ['right_hip', 'right_knee'], ['right_knee', 'right_ankle']
    ];
    
    connections.forEach(([from, to]) => {
        const kp1 = getKp(from);
        const kp2 = getKp(to);
        if (kp1 && kp2 && kp1.x && kp2.x) {
            line(kp1.x, kp1.y, kp2.x, kp2.y);
        }
    });
    
    // Draw keypoints
    fill(255, 0, 0);
    noStroke();
    const keypoints = pose.keypoints || [];
    keypoints.forEach(kp => {
        if (kp.x && kp.y) {
            ellipse(kp.x, kp.y, 8, 8);
        }
    });
}

function drawPuppet(pose, sceneIndex) {
    if (!pose) return;
    
    const scene = scenes[sceneIndex];
    
    // Mirror the entire puppet horizontally to match the person's position
    push();
    translate(width, 0);
    scale(-1, 1);
    
    // Helper to get keypoint by name (pass the full pose object)
    const getKp = (name) => findKeypoint(pose, name);
    
    // Draw head (at nose position) with rotation and perspective
    const nose = getKp('nose');
    const leftEye = getKp('leftEye');
    const rightEye = getKp('rightEye');
    const leftEar = getKp('leftEar');
    const rightEar = getKp('rightEar');
    
    if (nose && nose.x && nose.y && scene.puppetParts[0]) {
        const confidence = nose.confidence !== undefined ? nose.confidence : (nose.score !== undefined ? nose.score : 1);
        if (confidence > 0.3) {
            // Calculate perspective scale based on head tilt (forward/back)
            // When head tilts forward/back, eye distance decreases
            let headScaleX = 1;
            let headScaleY = 1;
            
            if (leftEye && rightEye && leftEye.x && rightEye.x) {
                const eyeDist = dist(leftEye.x, leftEye.y, rightEye.x, rightEye.y);
                // Assume normal eye distance when facing camera is around 60-80 pixels
                // Scale down when distance is less (head tilted away)
                const normalEyeDist = 70;
                headScaleX = map(constrain(eyeDist, 40, normalEyeDist), 40, normalEyeDist, 0.6, 1);
                
                // Also calculate vertical scale based on head tilt angle
                const eyeAngle = atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
                // When head tilts left/right, scale Y to create perspective
                headScaleY = map(abs(sin(eyeAngle)), 0, 1, 1, 0.85);
            }
            
            // Head size - bigger
            const headSize = 240;
            
            push();
            translate(nose.x, nose.y);
            imageMode(CENTER);
            scale(headScaleX, headScaleY);
            // Move down by 10% of head size (positive Y is down)
            image(scene.puppetParts[0], 0, -headSize * 0.4 + headSize * 0.1, headSize, headSize);
            pop();
        }
    }
    
    // Draw torso (between shoulders and hips) - moved up
    const leftShoulder = getKp('leftShoulder');
    const rightShoulder = getKp('rightShoulder');
    const leftHip = getKp('leftHip');
    const rightHip = getKp('rightHip');
    
    if (leftShoulder && rightShoulder && leftHip && rightHip) {
        const shoulderMid = {
            x: (leftShoulder.x + rightShoulder.x) / 2,
            y: (leftShoulder.y + rightShoulder.y) / 2
        };
        const hipMid = {
            x: (leftHip.x + rightHip.x) / 2,
            y: (leftHip.y + rightHip.y) / 2
        };
        
        const torsoWidth = dist(leftShoulder.x, leftShoulder.y, rightShoulder.x, rightShoulder.y);
        const torsoHeight = dist(shoulderMid.x, shoulderMid.y, hipMid.x, hipMid.y);
        const torsoX = shoulderMid.x - torsoWidth / 2;
        const torsoY = shoulderMid.y - torsoHeight * 0.3; // Move up by 30% of torso height (more than before)
        
        image(scene.puppetParts[1], torsoX, torsoY, torsoWidth, torsoHeight);
    }
    
    // Draw hips (between hips keypoints) - 150% bigger with rotation
    if (leftHip && rightHip && scene.puppetParts[2]) {
        const hipWidth = dist(leftHip.x, leftHip.y, rightHip.x, rightHip.y);
        const hipMid = {
            x: (leftHip.x + rightHip.x) / 2,
            y: (leftHip.y + rightHip.y) / 2
        };
        
        // Calculate rotation angle based on hip orientation
        // Add PI to rotate 180 degrees (hips image is oriented vertically, flipped)
        const hipAngle = atan2(rightHip.y - leftHip.y, rightHip.x - leftHip.x) + PI;
        
        // Draw hips image with rotation - 135% size (90% of 150%)
        const hipHeight = hipWidth * 0.8; // Slightly shorter than width
        const drawWidth = hipWidth * 1.35; // 90% of 1.5 = 1.35
        const drawHeight = hipHeight * 1.35; // 90% of 1.5 = 1.35
        
        push();
        translate(hipMid.x, hipMid.y);
        rotate(hipAngle);
        imageMode(CENTER);
        image(scene.puppetParts[2], 0, 0, drawWidth, drawHeight);
        pop();
    }
    
    // Draw left arm (shoulder to elbow)
    const leftElbow = getKp('leftElbow');
    if (leftShoulder && leftElbow) {
        drawLimb(scene.puppetParts[3], leftShoulder, leftElbow, 40);
    }
    
    // Draw right arm (shoulder to elbow)
    const rightElbow = getKp('rightElbow');
    if (rightShoulder && rightElbow) {
        drawLimb(scene.puppetParts[4], rightShoulder, rightElbow, 40);
    }
    
    // Draw left forearm (elbow to wrist) - 150% scale, offset right 50%
    const leftWrist = getKp('leftWrist');
    if (leftElbow && leftWrist) {
        const offsetX = 35 * 1.5 * 0.5; // 50% of scaled thickness
        drawLimb(scene.puppetParts[5], leftElbow, leftWrist, 35, 1.5, 0, offsetX);
    }
    
    // Draw right forearm (elbow to wrist) - 150% scale, offset right 50%
    const rightWrist = getKp('rightWrist');
    if (rightElbow && rightWrist) {
        const offsetX = 35 * 1.5 * 0.5; // 50% of scaled thickness
        drawLimb(scene.puppetParts[6], rightElbow, rightWrist, 35, 1.5, 0, offsetX);
    }
    
    // Draw left upper leg (hip to knee)
    const leftKnee = getKp('leftKnee');
    if (leftHip && leftKnee) {
        drawLimb(scene.puppetParts[7], leftHip, leftKnee, 45);
    }
    
    // Draw right upper leg (hip to knee)
    const rightKnee = getKp('rightKnee');
    if (rightHip && rightKnee) {
        drawLimb(scene.puppetParts[8], rightHip, rightKnee, 45);
    }
    
    // Draw left lower leg (knee to ankle) - 150% scale, offset right 50%
    const leftAnkle = getKp('leftAnkle');
    if (leftKnee && leftAnkle) {
        const offsetX = 40 * 1.5 * 0.5; // 50% of scaled thickness
        drawLimb(scene.puppetParts[9], leftKnee, leftAnkle, 40, 1.5, 0, offsetX);
    }
    
    // Draw right lower leg (knee to ankle) - 150% scale, offset right 50%
    const rightAnkle = getKp('rightAnkle');
    if (rightKnee && rightAnkle) {
        const offsetX = 40 * 1.5 * 0.5; // 50% of scaled thickness
        drawLimb(scene.puppetParts[10], rightKnee, rightAnkle, 40, 1.5, 0, offsetX);
    }
    
    pop();
}

function drawLimb(img, point1, point2, thickness, scale = 1.0, offsetY = 0, offsetX = 0) {
    if (!img || !point1 || !point2) return;
    if (!point1.x || !point1.y || !point2.x || !point2.y) return;
    
    // Check confidence (ml5 v1 uses confidence or score)
    const conf1 = point1.confidence !== undefined ? point1.confidence : (point1.score !== undefined ? point1.score : 1);
    const conf2 = point2.confidence !== undefined ? point2.confidence : (point2.score !== undefined ? point2.score : 1);
    if (conf1 < 0.3 || conf2 < 0.3) return;
    
    const angle = atan2(point2.y - point1.y, point2.x - point1.x);
    const length = dist(point1.x, point1.y, point2.x, point2.y);
    
    push();
    translate(point1.x, point1.y);
    rotate(angle);
    imageMode(CENTER);
    
    // If img is a p5.Image, use it directly. If it's a p5.Graphics, also works.
    if (img.width && img.height) {
        // Use the image's aspect ratio to determine thickness if not specified, scaled
        const imgThickness = (thickness || img.height) * scale;
        const imgLength = (length || img.width) * scale;
        // Apply offsets - offsetX moves "right" along limb direction, offsetY moves "down" perpendicular
        image(img, length / 2 + offsetX, offsetY, imgLength, imgThickness);
    }
    pop();
}

function draw() {
    // Draw background video full screen
    if (bgVideo && bgVideo.width > 0 && bgVideo.height > 0) {
        noTint();
        image(bgVideo, 0, 0, width, height);
    } else {
        // Black background as fallback
        background(0, 0, 0);
    }
    
    // Video feed is hidden - only showing puppet skeleton
    
    // Draw puppets if poses exist - each person gets a different scene's assets
    if (poses && poses.length > 0) {
        for (let i = 0; i < poses.length; i++) {
            if (poses[i] && poses[i].pose) {
                // Use the tracked scene index (maintains consistent assignment)
                const personSceneIndex = poses[i].sceneIndex !== undefined 
                    ? poses[i].sceneIndex 
                    : (i % NUM_SCENES); // Fallback to index-based if tracking failed
                drawPuppet(poses[i].pose, personSceneIndex);
            }
        }
    }
    
}

function windowResized() {
    // Ignore resizes before setup() has run - setup sizes everything to the window anyway
    if (!bgVideo) return;

    resizeCanvas(windowWidth, windowHeight);
    if (video) video.size(width, height);
    
    // Recreate scene backgrounds for new size
    initializeScenes();
}

