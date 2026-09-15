"""Regenerate edited demo clips/stills with FFmpeg; captions are reviewed source assets."""
import subprocess,pathlib,os,shutil
root=pathlib.Path(__file__).resolve().parents[1]/'public'
out=root/'media';out.mkdir(exist_ok=True)
f=os.environ.get('HAUDDY_FFMPEG') or shutil.which('ffmpeg')
if not f: raise SystemExit('Install FFmpeg or set HAUDDY_FFMPEG to its executable path.')
for name,start,duration in [('demo-overview',15,25),('demo-reply',30,10)]:
 subprocess.run([f,'-y','-ss',str(start),'-i',str(root/'demo.mp4'),'-t',str(duration),'-an','-vf','crop=1920:940:0:0,scale=1280:626','-c:v','libx264','-crf','25','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart',str(out/(name+'.mp4'))],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for name,sec in [('demo-poster',24),('demo-messages',39)]:
 subprocess.run([f,'-y','-ss',str(sec),'-i',str(root/'demo.mp4'),'-frames:v','1','-vf','crop=1920:940:0:0,scale=1280:626','-quality','88',str(out/(name+'.webp'))],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
print('Generated silent clips and stills; review captions after changing any edit timings.')
