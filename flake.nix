{
  description = "SpiderByte CLI";

  inputs = {
    # Pinned to the 25.11 release channel because nixpkgs-unstable currently
    # ships nodejs_24 = 24.14.1, which trips the >= 24.15.0 floor that the
    # native SEA build enforces (see apps/cli/scripts/native/build.mjs).
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  };

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems =
        f:
        lib.genAttrs systems (
          system:
          f (import nixpkgs {
            inherit system;
          })
        );

      minNodeVersion = "24.15.0";

      # Hardcode to Node.js 24.x; fail the evaluation if the pinned nixpkgs
      # does not offer a new enough 24.x.
      nodejsFor =
        pkgs:
        let
          node = pkgs.nodejs_24;
        in
        if lib.versionAtLeast node.version minNodeVersion then
          node
        else
          throw ''
            SpiderByte requires Node.js >= ${minNodeVersion},
            but nixpkgs only offers ${node.version}.
            Pin a newer nixpkgs revision or update minNodeVersion in flake.nix.
          '';

      pnpmFor =
        pkgs:
        pkgs.pnpm_10.override {
          nodejs = nodejsFor pkgs;
        };

      # -------------------------------------------------------------------
      # Workspace members (kept in sync with pnpm-workspace.yaml).
      #
      # HARD REQUIREMENT: whenever you add or remove a workspace package,
      # you MUST update both lists below. Missing a path will break the Nix
      # build (src fileset silently drops files); missing a name will break
      # pnpmConfigHook (dependencies for that workspace won't be fetched).
      # -------------------------------------------------------------------
      workspacePaths = [
        ./commercial/domain
        ./commercial/ports
        ./commercial/application
        ./commercial/adapters
        ./commercial/api
        ./commercial/billing
        ./commercial/compute
        ./commercial/artifacts
        ./commercial/admin
        ./commercial/enterprise
        ./commercial/persistence
        ./commercial/sdk
        ./commercial/mcp
        ./packages/acp-server
        ./packages/agent-core
        ./packages/kap-server
        ./packages/kaos
        ./packages/client
        ./packages/kosong
        ./packages/minidb
        ./packages/sdk
        ./packages/oauth
        ./packages/pi-tui
        ./packages/protocol
        ./packages/telemetry
        ./packages/transcript
        ./packages/tree-sitter-bash
        ./apps/cli
        ./apps/spiderbyte-vscode
        ./apps/inspect
        ./docs
      ];

      workspaceNames = [
        "@spiderbyte/commercial-domain"
        "@spiderbyte/commercial-ports"
        "@spiderbyte/commercial-application"
        "@spiderbyte/commercial-adapters"
        "@spiderbyte/commercial-api"
        "@spiderbyte/commercial-billing"
        "@spiderbyte/commercial-compute"
        "@spiderbyte/commercial-artifacts"
        "@spiderbyte/commercial-admin"
        "@spiderbyte/commercial-enterprise"
        "@spiderbyte/commercial-persistence"
        "@spiderbyte/commercial-sdk"
        "@spiderbyte/commercial-mcp"
        "@spiderbyte/acp-server"
        "@spiderbyte/agent-core"
        "@spiderbyte/kap-server"
        "@spiderbyte/kaos"
        "@spiderbyte/kosong"
        "@spiderbyte/minidb"
        "@spiderbyte/sdk"
        "@spiderbyte/oauth"
        "@spiderbyte/client"
        "@spiderbyte/pi-tui"
        "@spiderbyte/protocol"
        "@spiderbyte/telemetry"
        "@spiderbyte/transcript"
        "@spiderbyte/tree-sitter-bash"
        "@spiderbyte/cli"
        "spiderbyte-vscode"
        "@spiderbyte/inspect"
        "spiderbyte-docs"
      ];
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          nodejs = nodejsFor pkgs;
          pnpm = pnpmFor pkgs;
          appPackageJson = builtins.fromJSON (builtins.readFile ./apps/cli/package.json);
          nativeTarget =
            if pkgs.stdenv.hostPlatform.isLinux && pkgs.stdenv.hostPlatform.isAarch64 then
              "linux-arm64"
            else if pkgs.stdenv.hostPlatform.isLinux then
              "linux-x64"
            else if pkgs.stdenv.hostPlatform.isDarwin && pkgs.stdenv.hostPlatform.isAarch64 then
              "darwin-arm64"
            else if pkgs.stdenv.hostPlatform.isDarwin then
              "darwin-x64"
            else
              throw "Unsupported SpiderByte native target for ${pkgs.stdenv.hostPlatform.system}";

          spyderbyte = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "spyderbyte";
            version = appPackageJson.version;

            src = lib.fileset.toSource {
              root = ./.;
              fileset = lib.fileset.unions (
                [
                  ./build
                  ./.npmrc
                  ./.nvmrc
                  ./package.json
                  ./pnpm-lock.yaml
                  ./pnpm-workspace.yaml
                  ./tsconfig.json
                  ./vitest.config.ts
                  ./LICENSE
                ]
                ++ workspacePaths
              );
            };

            pnpmWorkspaces = [ "." ] ++ workspaceNames;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src pnpmWorkspaces;
              inherit pnpm;
              fetcherVersion = 3;
              hash = "sha256-P450+LKDYkRyk7OZ2mSOX0/RwtbivwR5ZksN8FM6+TU=";
            };

            nativeBuildInputs = [
              nodejs
              pnpm
              (pkgs.pnpmConfigHook.override { inherit pnpm; })
              pkgs.makeWrapper
            ]
            # The SEA inject step (postject) invalidates the macOS code
            # signature on the copied Node executable; build.mjs then re-applies
            # an ad-hoc signature via `codesign`. The Nix darwin sandbox does
            # not expose /usr/bin/codesign, so we supply nixpkgs' ad-hoc-only
            # replacement instead.
            ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
              pkgs.darwin.sigtool
            ];

            # The SEA binary is produced by `postject`-injecting a blob into a
            # plain Node executable. Stripping rewrites section tables and can
            # invalidate the injected blob's offsets, so leave the binary
            # untouched after the build.
            dontStrip = true;

            buildPhase = ''
              runHook preBuild
              export SPIDERBYTE_BUILD_TARGET=${nativeTarget}
              ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
                # pkgs.darwin.sigtool's codesign supports `--sign -` (ad-hoc)
                # but not the inspection mode (`-dv`) that 05-verify.mjs runs
                # afterwards. Disable the verify step for the Nix build; the
                # release CI keeps it via the unmodified script.
                substituteInPlace apps/cli/scripts/native/build.mjs \
                  --replace-fail \
                    "await runVerifyStep({ requireGatekeeper: false });" \
                    "// runVerifyStep skipped in nix sandbox (sigtool lacks -dv)"
              ''}
              pnpm --filter=@spiderbyte/cli run build:native:sea
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              install -Dm755 \
                "apps/cli/dist-native/bin/${nativeTarget}/spyderbyte" \
                "$out/bin/spyderbyte"

              runHook postInstall
            '';

            postInstall = ''
              wrapProgram $out/bin/spyderbyte --prefix PATH : ${lib.makeBinPath [ pkgs.ripgrep pkgs.fd ]}
            '';

            meta = {
              description = "SpiderByte CLI";
              homepage = "https://github.com/josiah1203/spiderbyte";
              license = lib.licenses.mit;
              mainProgram = "spyderbyte";
              platforms = systems;
            };
          });
        in
        {
          inherit spyderbyte;
          default = spyderbyte;
        }
      );

      apps = forAllSystems (pkgs: {
        spyderbyte = {
          type = "app";
          program = "${self.packages.${pkgs.system}.spyderbyte}/bin/spyderbyte";
        };
        default = self.apps.${pkgs.system}.spyderbyte;
      });

      devShells = forAllSystems (pkgs: {
        default =
          let
            nodejs = nodejsFor pkgs;
            pnpm = pnpmFor pkgs;
          in
          pkgs.mkShell {
            packages = [
              nodejs
              pnpm
              pkgs.ripgrep
              pkgs.fd
            ];
          };
      });
    };
}
