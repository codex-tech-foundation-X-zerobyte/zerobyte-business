import postcss from 'postcss'
import fs from 'fs'
const pat=new RegExp(process.argv[2])
for (const f of ['styles.css','design.css','polish.css','theme.css','layout.css','scroll.css']){
  postcss.parse(fs.readFileSync('src/'+f,'utf8')).walkRules(r=>{
    if(r.selectors.some(s=>pat.test(s))){
      const media=[]; let p=r.parent; while(p&&p.type==='atrule'){media.push('@'+p.name+' '+p.params); p=p.parent}
      console.log(`${f}:${r.source.start.line} ${media.join(' ')} ${r.selector.slice(0,110)} { ${r.nodes.map(n=>n.prop+':'+n.value).join('; ').slice(0,210)} }`)
    }
  })
}
