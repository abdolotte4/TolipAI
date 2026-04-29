{ pkgs }: {
  deps = [
    pkgs.python311
    pkgs.playwright-driver.browsers
    pkgs.libGL
    pkgs.libGLU
    pkgs.glib
    pkgs.nss
    pkgs.nspr
    pkgs.atk
    pkgs.at-spi2-atk
    pkgs.cups
    pkgs.libdrm
    pkgs.dbus
    pkgs.libxkbcommon
    pkgs.mesa
    pkgs.pango
    pkgs.cairo
    pkgs.alsa-lib
    pkgs.tesseract
  ];
}
