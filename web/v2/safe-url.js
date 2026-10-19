// Only http(s) links may become clickable; javascript:, data: and unparsable values return null.
export function safeHref(url) {try{const parsed=new URL(String(url??''));return ['http:','https:'].includes(parsed.protocol)?parsed.href:null;}catch{return null;}}
