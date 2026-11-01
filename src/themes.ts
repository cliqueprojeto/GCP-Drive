import {UserError,userMessage} from './user-error.ts';
export type ThemeColors={background:string;surface:string;text:string;muted:string;accent:string;border:string};
export type ThemeDefinition={id:string;name:string;mode:'light'|'dark';colors:ThemeColors};
const light=(id:string,name:string,accent:string,background:string):ThemeDefinition=>({id,name,mode:'light',colors:{background,surface:'#ffffff',text:'#25273a',muted:'#707487',accent,border:'#e2dfeb'}});
const dark=(id:string,name:string,accent:string,background:string,surface:string):ThemeDefinition=>({id,name,mode:'dark',colors:{background,surface,text:'#f3eff8',muted:'#b3aebf',accent,border:'#3e3b4c'}});
export const builtinThemes:ThemeDefinition[]=[light('lavanda','Lavanda','#6750ce','#f6f5fb'),light('brisa','Brisa','#286b95','#f1f8fc'),light('areia','Areia','#876136','#faf7f0'),dark('ametista','Ametista','#b49aed','#15121e','#231d31'),dark('oceano','Oceano','#71c9ee','#10202b','#1a303e'),dark('floresta','Floresta','#85cea7','#101e18','#20352a')];
/** Theme packages are bounded data, never arbitrary CSS, fonts, URLs or executable code. */
export function parseTheme(value:unknown,id:string):ThemeDefinition{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new UserError('Tema inválido.');
  const item=value as Record<string,unknown>;
  if(Object.keys(item).some(k=>!['name','mode','colors'].includes(k))||typeof item.name!=='string'||!item.name.trim()||item.name.length>40||/[\x00-\x1f]/.test(item.name)||(item.mode!=='light'&&item.mode!=='dark')||!item.colors||typeof item.colors!=='object'||Array.isArray(item.colors))throw new UserError('O tema deve conter somente nome, modo e paleta de cores.');
  const colors=item.colors as Record<string,unknown>,keys=['background','surface','text','muted','accent','border'];
  if(Object.keys(colors).length!==keys.length||!keys.every(key=>typeof colors[key]==='string'&&/^#[0-9a-f]{6}$/i.test(colors[key] as string)))throw new UserError('Use as seis cores do modelo em formato hexadecimal #RRGGBB.');
  return{id,name:item.name.trim(),mode:item.mode,colors:colors as ThemeColors};
}
