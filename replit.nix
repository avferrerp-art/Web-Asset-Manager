{pkgs}: {
  deps = [
    pkgs.libglvnd
    pkgs.libxkbcommon
    pkgs.libuuid
    pkgs.cairo
    pkgs.pango
    pkgs.libdrm
    pkgs.mesa
    pkgs.alsa-lib
    pkgs.xorg.libXtst
    pkgs.xorg.libxcb
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.xorg.libX11
    pkgs.expat
    pkgs.dbus
    pkgs.cups
    pkgs.atk
    pkgs.nspr
    pkgs.nss
    pkgs.glib
  ];
}
