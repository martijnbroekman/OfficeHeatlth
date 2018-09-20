import json
import threading
import time

from client import Client
import cv2
import dlib
import imutils
from detection import fatigue
from detection import posture
from detection.emotion_detection import EMD
from models.Emotion import EMR
from models.Result import Result

# define two constants, one for the eye aspect ratio to indicate
# blink and then a second constant for the number of consecutive
# frames the eye must be below the threshold for to sent a notification
EYE_AR_THRESH = 0.3
EYE_AR_CONSEC_FRAMES = 48

class Detector:

    def __init__(self):
        print("[INFO] loading facial landmark predictor")

        self.detector = dlib.get_frontal_face_detector()
        self.predictor = dlib.shape_predictor("shape_predictor_68_face_landmarks.dat")
        self.emd = EMD(self.predictor, self.detector)

        #Initialize network
        self.network = EMR()
        self.network.build_network()

        #Initialize camera
        self.cap = cv2.VideoCapture(0)

        self.client = Client()

        # Init camera time
        time.sleep(1.0)


    def rect_to_bb(self, rect):
        x = rect.left()
        y = rect.top()
        w = rect.right() - x
        h = rect.bottom() - y

        # return a tuple of (x, y, w, h)
        return x, y, w, h

    def start(self):
        print("[INFO] loading facial landmark predictor")
        detector = dlib.get_frontal_face_detector()
        predictor = dlib.shape_predictor("shape_predictor_68_face_landmarks.dat")
        self.emd = EMD(predictor, detector)

    def stop(self):
        self.cap.release()

    def start_reading(self):
        # grab the indexes of the facial landmarks for the left and
        # right eye, respectively
        (lStart, lEnd, rStart, rEnd) = fatigue.calculate_landmarks()

        COUNTER = 0
        POSTURE = True
        FATIGUE = False

        # Again find haar cascade to draw bounding box around face
        ret, frame = self.cap.read()

        frame = imutils.resize(frame, width=450)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Detect faces
        rects = self.detector(gray, 0)

        for rect in rects:
            POSTURE =  posture.check_posture(rect)

            EAR = fatigue.calculate_ear(self.predictor(gray, rect), lStart, lEnd, rStart, rEnd)

            # Check if EAR is below blink treshold. If true, increase blink frame counter
            if EAR < EYE_AR_THRESH:
                COUNTER += 1

                # If eyes were closed for a sufficient number of frames, drowsiness is detected
                if COUNTER >= EYE_AR_CONSEC_FRAMES:
                    FATIGUE = True

            else:
                COUNTER = 0

            # compute softmax probabilities
            result = self.network.predict(self.emd.format_image(gray, rects))

            return json.dumps(Result(self.emd.parse_emotions(result), POSTURE, FATIGUE).__dict__)