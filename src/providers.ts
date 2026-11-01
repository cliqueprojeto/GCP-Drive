export const providers = {
  drive:{name:'Google Drive',web:'https://drive.google.com/drive/u/0/my-drive',oauth:true},
  onedrive:{name:'OneDrive',web:'https://onedrive.live.com/',oauth:true},
  dropbox:{name:'Dropbox',web:'https://www.dropbox.com/home',oauth:true},
  mega:{name:'MEGA',web:'https://mega.nz/fm',oauth:false},
  protondrive:{name:'Proton Drive',web:'https://drive.proton.me/',oauth:false},
} as const;
