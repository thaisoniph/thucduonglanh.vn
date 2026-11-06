// Thử ô Tìm của trang hướng dẫn: python3 build.py rồi node scripts/test-guide-search.js [file câu thử]. In 2 kết quả đầu mỗi câu.
const fs=require('fs');let src=fs.readFileSync(__dirname + '/../guide/guide.js','utf8').replace("window.addEventListener('popstate', highlight);\n  highlight();","window.__t={search,load};");
global.document={addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};global.window=global;global.fetch=()=>Promise.resolve({json:()=>JSON.parse(fs.readFileSync(__dirname + '/../dist-crm/huong-dan/search.json','utf8'))});eval(src);
const qs=fs.readFileSync(process.argv[2] || __dirname + '/guide-search-cau-thu.txt','utf8').trim().split('\n');
__t.load().then(()=>{let z=0;for(const q of qs){const r=__t.search(q);if(!r.length)z++;console.log((r.length?'  ':'❌')+q.padEnd(34),r.length,'|',r.slice(0,2).map(x=>x.e.p+': '+x.e.h).join(' ; ').slice(0,120))}console.log('Không ra kết quả:',z,'/',qs.length)});
