{
  description = "SOPSie VS Code extension dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            just
          ];

          shellHook = ''
            echo "SOPSie VS Code extension dev shell"
            echo "  node $(node --version), npm $(npm --version)"
            echo "  sops $(sops --version 2>&1 | head -1)"
            echo ""
            echo "Run 'just' to see available commands."
          '';
        };
      }
    );
}
