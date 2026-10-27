import sys, json, io, base64
import qrcode
url = sys.argv[1] if len(sys.argv) > 1 else ''
if not url:
    print(json.dumps({'ok': False})); sys.exit(1)
img = qrcode.make(url, box_size=6, border=2)
b = io.BytesIO()
img.save(b, format='PNG')
print(json.dumps({'ok': True, 'png': base64.b64encode(b.getvalue()).decode()}))
