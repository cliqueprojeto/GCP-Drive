import {readdir,readFile,copyFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const [root,destination,version]=process.argv.slice(2);
assert.ok(root&&destination&&/^\d+\.\d+\.\d+-beta\.\d+$/.test(version));
const groups={
 'windows-x64':[`GCP-Drive-Setup-${version}-x64.exe`],
 'linux-x64':[`GCP-Drive-${version}-linux-amd64.deb`,`GCP-Drive-${version}-linux-x86_64.rpm`,`GCP-Drive-${version}-linux-x86_64.AppImage`],
 'macos-x64':[`GCP-Drive-${version}-macOS-x64.dmg`],
 'macos-arm64':[`GCP-Drive-${version}-macOS-arm64.dmg`]
};
assert.deepEqual((await readdir(root)).sort(),Object.keys(groups).map(group=>'gcp-drive-'+group).sort());
await mkdir(destination,{recursive:true});const lines=[];
for(const [group,expected]of Object.entries(groups)){
 const directory=path.join(root,'gcp-drive-'+group),actual=await readdir(directory);
 assert.deepEqual(actual.filter(name=>/\.(exe|deb|rpm|dmg|AppImage)$/.test(name)).sort(),[...expected].sort());
 const sums=await readFile(path.join(directory,'SHA256SUMS'),'utf8');
 for(const name of expected){
  const bytes=await readFile(path.join(directory,name));assert.ok(bytes.length>20*1024*1024);
  const digest=createHash('sha256').update(bytes).digest('hex');
  assert.equal(sums.split(/\r?\n/).filter(line=>line===digest+'  '+name).length,1,'Checksum da compilação: '+name);
  if(name.endsWith('.exe'))assert.equal(bytes.subarray(0,2).toString(),'MZ');
  if(name.endsWith('.deb'))assert.equal(bytes.subarray(0,8).toString(),'!<arch>\n');
  if(name.endsWith('.rpm'))assert.equal(bytes.subarray(0,4).toString('hex'),'edabeedb');
  if(name.endsWith('.AppImage'))assert.equal(bytes.subarray(0,4).toString('hex'),'7f454c46');
  if(name.endsWith('.dmg'))assert.equal(bytes.subarray(-512,-508).toString(),'koly');
  await copyFile(path.join(directory,name),path.join(destination,name));lines.push(digest+'  '+name);
 }
}
await writeFile(path.join(destination,'SHA256SUMS'),lines.sort().join('\n')+'\n');
await copyFile(path.join(root,'gcp-drive-windows-x64','LEIA-ME-TESTES.txt'),path.join(destination,'LEIA-ME-TESTES.txt'));
assert.equal((await readdir(destination)).length,8);
console.log(JSON.stringify({verified:true,installers:lines.length,version}));
