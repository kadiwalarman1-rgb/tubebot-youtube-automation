{ pkgs }: {
  deps = [
    pkgs.nodejs-20_x
    pkgs.python311
    pkgs.python311Packages.pip
    pkgs.ffmpeg
    pkgs.cairo
    pkgs.pango
    pkgs.libjpeg
    pkgs.libpng
    pkgs.giflib
    pkgs.pixman
    pkgs.pkg-config
  ];
}
