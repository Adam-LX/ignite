{
  description = "FlyBall — browser car soccer (RocketGoal-style fork)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      musicShell = pkgs.mkShell {
        packages = with pkgs; [
          ffmpeg
          python3
          python3Packages.pip
          python3Packages.setuptools
          python3Packages.wheel
          python3Packages.numpy
          python3Packages.scipy
          python3Packages.pyyaml
          git
          curl
          stdenv.cc.cc.lib
        ];
        shellHook = ''
          export FLYBALL_MUSIC_VENV="$PWD/.venv-music"
          export LD_LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
          echo "FlyBall Music — flyball-music setup | flyball-music generate --style racer_like"
        '';
      };
    in {
      devShells.${system} = {
        default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            nix-ld
            biome
            git
            git-lfs
            tea
            rsync
            zstd
            ffmpeg
            python3
            python3Packages.numpy
            nsis
            p7zip
            godot_4
            dpkg
            gh
            fpm
            playwright-driver.browsers
          ];

          shellHook = ''
            export NIX_LD="${pkgs.nix-ld}/libexec/nix-ld"
            export NIX_LD_LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib"
            export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}/share/playwright"
            echo "FlyBall — npm run dev → http://localhost:5173"
            echo "Godot Ignite: ./godot/ignite/run.sh  (lub: cd godot/ignite && godot --path .)"
            echo "Windows ZIP: ./scripts/build-windows-portable.sh"
            echo "Ubuntu DEB: ./scripts/build-linux-deb.sh"
            echo "Publish Codeberg: ./scripts/publish-codeberg.sh [win|linux|source|all]"
            echo "Publish GitHub:   ./scripts/publish-github-releases.sh [--push-downloads]"
            echo "E2E match:        npm run test:e2e"
            echo "Assets: scripts/build_assets.sh (ffmpeg + python3)"
          '';
        };

        music = musicShell;
      };
    };
}
