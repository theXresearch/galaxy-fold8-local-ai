#!/usr/bin/env node
'use strict';
// Local-only inventory. No uploads, moves or deletes.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(process.argv[2] || '/storage/emulated/0/Download');
const MAX_FILES = 50000;
const SKIP = new Set(['Android', '.thumbnails', '.Trash', 'Fold8Trash']);
async function main() {
  const files = [], errors = [], stack = [root];
  while (stack.length && files.length < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try { entries = await fs.readdir(dir, {withFileTypes:true}); }
    catch(e) { errors.push({directory:dir, code:e.code}); continue; }
    for (const ent of entries) {
      if (ent.isSymbolicLink() || ent.name.startsWith('.') || SKIP.has(ent.name)) continue;
      const full = path.join(dir,ent.name);
      if (ent.isDirectory()) { stack.push(full); continue; }
      if (!ent.isFile()) continue;
      try {
        const st=await fs.stat(full);
        files.push({path:path.relative(root,full), bytes:st.size, modified:st.mtime.toISOString()});
      } catch(e) {errors.push({path:path.relative(root,full),code:e.code});}
      if(files.length>=MAX_FILES) break;
    }
  }
  const byExt={}; const bySize=new Map();
  for(const f of files) {
    const ext=path.extname(f.path).toLowerCase() || '(none)';
    const item=byExt[ext] ||= {count:0,bytes:0};
    item.count++;item.bytes+=f.bytes;
    if(f.bytes>0) {const a=bySize.get(f.bytes)||[];a.push(f);bySize.set(f.bytes,a);}
  }
  const duplicates=[];
  for(const group of bySize.values()) {
    if(group.length<2) continue;
    const hashes=new Map();
    for(const f of group) {
      try {
        const data=await fs.readFile(path.join(root,f.path));
        const hash=crypto.createHash('sha256').update(data).digest('hex');
        const a=hashes.get(hash)||[];a.push(f.path);hashes.set(hash,a);
      } catch(e) {errors.push({path:f.path,code:e.code});}
    }
    for(const paths of hashes.values()) if(paths.length>1) duplicates.push({bytesEach:group[0].bytes,paths});
  }
  const report={root,scannedFiles:files.length,limitReached:files.length>=MAX_FILES,
    totalBytes:files.reduce((n,f)=>n+f.bytes,0),byExtension:byExt,
    largestFiles:[...files].sort((a,b)=>b.bytes-a.bytes).slice(0,30),
    duplicates,errors};
  const out=path.join(process.cwd(),'fold8-inventory.json');
  await fs.writeFile(out,JSON.stringify(report,null,2),{flag:'w',mode:0o600});
  console.log('Report saved locally:',out);
  console.log('Files:',files.length,'Duplicate groups:',duplicates.length,'Errors:',errors.length);
  console.log('No files were moved or deleted. Do not upload the report: it contains filenames.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
