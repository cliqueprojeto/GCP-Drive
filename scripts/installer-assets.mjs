import {writeFile} from 'node:fs/promises';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import QRCode from 'qrcode';
import {PIX} from '../src/support.ts';
await writeFile('assets/pix-qr.svg',await QRCode.toString(PIX,{type:'svg',errorCorrectionLevel:'M',margin:4,color:{dark:'#151322',light:'#ffffff'}}));
const icon=await loadImage('assets/icon.png');
function bmp(canvas){const {width:w,height:h}=canvas;const data=canvas.getContext('2d').getImageData(0,0,w,h).data;const stride=Math.ceil(w*3/4)*4;const result=Buffer.alloc(54+stride*h);result.write('BM');result.writeUInt32LE(result.length,2);result.writeUInt32LE(54,10);result.writeUInt32LE(40,14);result.writeInt32LE(w,18);result.writeInt32LE(h,22);result.writeUInt16LE(1,26);result.writeUInt16LE(24,28);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const from=(y*w+x)*4,to=54+(h-1-y)*stride+x*3;result[to]=data[from+2];result[to+1]=data[from+1];result[to+2]=data[from];}return result;}
for(const [name,w,h] of [['installer-header',150,57],['installer-sidebar',164,314]]){
 const canvas=createCanvas(w,h),c=canvas.getContext('2d');const g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,'#8364ea');g.addColorStop(1,'#31206f');c.fillStyle=g;c.fillRect(0,0,w,h);
 if(h>100){c.drawImage(icon,38,38,88,88);c.fillStyle='#fff';c.font='bold 21px Segoe UI';c.fillText('GCP-Drive',22,161);c.font='12px Segoe UI';c.fillStyle='#e4dcff';c.fillText('Suas nuvens.',22,188);c.fillText('Seu espaço.',22,206);c.font='10px Segoe UI';c.fillText('BRUNO ALBERTINI',22,275);c.fillText('GESTÃO CULTURAL PRO',22,291);}else{c.drawImage(icon,10,8,41,41);c.fillStyle='#fff';c.font='bold 15px Segoe UI';c.fillText('GCP-Drive',57,34);}
 await writeFile(`assets/${name}.bmp`,bmp(canvas));
}
console.log('Recursos do instalador e QR PIX gerados a partir das fontes versionadas.');
