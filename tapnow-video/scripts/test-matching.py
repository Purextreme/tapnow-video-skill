"""Feature matching: transformed positive, absent control, duplicates, ROI and bad templates."""
import importlib.util
import unittest
from pathlib import Path
import cv2
import numpy as np

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('matcher',HERE/'match-control.py')
matcher=importlib.util.module_from_spec(spec)
spec.loader.exec_module(matcher)

class MatchingTests(unittest.TestCase):
    def setUp(self):
        self.template=matcher.read_image(HERE.parent/'assets/controls/continue-video.png')
        self.frame=np.full((150,300,3),40,dtype=np.uint8)
    def put(self,x,y,scale=1):
        t=cv2.resize(self.template,None,fx=scale,fy=scale,interpolation=cv2.INTER_CUBIC)
        self.frame[y:y+t.shape[0],x:x+t.shape[1]]=t
    def test_scaled_control(self):
        self.put(123,45,1.5)
        r=matcher.locate(self.frame,self.template,scales=[1,1.5,2])
        self.assertTrue(r['accepted'],r)
        self.assertLess(abs(r['match']['x']-123),2)
    def test_absent(self):
        self.assertFalse(matcher.locate(self.frame,self.template)['accepted'])
    def test_duplicates_and_roi(self):
        self.put(40,50);self.put(190,50)
        self.assertEqual(matcher.locate(self.frame,self.template)['reason'],'ambiguous')
        self.assertTrue(matcher.locate(self.frame,self.template,roi=[10,20,100,100])['accepted'])
    def test_invalid_inputs(self):
        with self.assertRaises(ValueError):matcher.locate(self.frame,np.zeros((20,20,3),dtype=np.uint8))
        with self.assertRaises(ValueError):matcher.locate(self.frame,self.template,roi=[0,0,400,400])

if __name__=='__main__':unittest.main()
