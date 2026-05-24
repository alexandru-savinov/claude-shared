{
  description = "claude-shared: user-level Claude Code config, consumed as a flake input";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    flake-parts.url = "github:hercules-ci/flake-parts";

    claude-code = {
      url = "github:sadjow/claude-code-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { self, nixpkgs, ... }@inputs:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      homeManagerModules.default = _: {
        imports = [ ./module ];
        _module.args.inputs = inputs;
      };

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);

      checks = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          inherit (pkgs) lib;

          mkHm =
            userConfig:
            inputs.home-manager.lib.homeManagerConfiguration {
              inherit pkgs;
              modules = [
                self.homeManagerModules.default
                {
                  home.username = "claude-test";
                  home.homeDirectory = "/home/claude-test";
                  home.stateVersion = "24.05";
                  programs.claude-code = userConfig;
                }
              ];
            };

          allEnabled = mkHm {
            enable = true;
            installPackage = false;
            contentRepoPath = "/home/claude-test/.claude-shared";
            zellijIntegration.enable = true;
            userClaudeMd = pkgs.writeText "test-CLAUDE.md" "# test user CLAUDE.md\n";
            extraEnabledPlugins = {
              "revdiff@revdiff" = true;
            };
            extraKnownMarketplaces = {
              revdiff = {
                name = "revdiff";
                source = {
                  source = "github";
                  repo = "alexandru-savinov/revdiff";
                };
              };
            };
            extraSettings = {
              theme = "dark";
            };
          };

          disabled = mkHm {
            enable = false;
          };
        in
        {
          module-all-enabled =
            pkgs.runCommand "module-all-enabled"
              {
                skillsSource = toString allEnabled.config.home.file.".claude/skills".source;
                agentsSource = toString allEnabled.config.home.file.".claude/agents".source;
                commandsSource = toString allEnabled.config.home.file.".claude/commands".source;
                claudeMdSource = toString allEnabled.config.home.file.".claude/CLAUDE.md".source;
                activationKeys = lib.concatStringsSep " " (lib.attrNames allEnabled.config.home.activation);
                cloneScript = allEnabled.config.home.activation.claudeSharedClone.data;
                settingsScript = allEnabled.config.home.activation.claudeSettings.data;
                pluginsScript = allEnabled.config.home.activation.claudeInstalledPlugins.data;
              }
              ''
                set -eu
                echo "skills source:  $skillsSource"
                echo "agents source:  $agentsSource"
                echo "commands source: $commandsSource"
                echo "CLAUDE.md source: $claudeMdSource"
                echo "activation keys: $activationKeys"

                # All three of our activation hooks must be present.
                for k in claudeSharedClone claudeSettings claudeInstalledPlugins; do
                  case " $activationKeys " in
                    *" $k "*) ;;
                    *) echo "FAIL: missing activation: $k"; exit 1 ;;
                  esac
                done

                # Clone script must reference HTTPS git remote and the configured path.
                case "$cloneScript" in
                  *"https://github.com/alexandru-savinov/claude-shared.git"*) ;;
                  *) echo "FAIL: clone script missing HTTPS git URL"; exit 1 ;;
                esac
                case "$cloneScript" in
                  *"/home/claude-test/.claude-shared"*) ;;
                  *) echo "FAIL: clone script missing contentRepoPath"; exit 1 ;;
                esac

                # Settings activation must install claude-settings.json by hash compare.
                case "$settingsScript" in
                  *"claude-settings.json"*) ;;
                  *) echo "FAIL: settings script missing claude-settings.json"; exit 1 ;;
                esac
                case "$settingsScript" in
                  *".claude/settings.json"*) ;;
                  *) echo "FAIL: settings script missing target path"; exit 1 ;;
                esac

                # Installed-plugins activation must write installed_plugins.json.
                case "$pluginsScript" in
                  *"installed_plugins.json"*) ;;
                  *) echo "FAIL: plugins script missing installed_plugins.json"; exit 1 ;;
                esac

                # CLAUDE.md should be the writeText derivation we passed in.
                case "$claudeMdSource" in
                  /nix/store/*-test-CLAUDE.md) ;;
                  *) echo "FAIL: CLAUDE.md source unexpected: $claudeMdSource"; exit 1 ;;
                esac

                touch $out
              '';

          module-disabled =
            pkgs.runCommand "module-disabled"
              {
                homeFileKeys = lib.concatStringsSep " " (lib.attrNames disabled.config.home.file);
                activationKeys = lib.concatStringsSep " " (lib.attrNames disabled.config.home.activation);
              }
              ''
                set -eu
                echo "home.file keys: $homeFileKeys"
                echo "activation keys: $activationKeys"

                # No .claude/* writes when disabled.
                for f in $homeFileKeys; do
                  case "$f" in
                    .claude/*) echo "FAIL: unexpected .claude file: $f"; exit 1 ;;
                  esac
                done

                # None of our activation hooks should fire when disabled.
                for k in claudeSharedClone claudeSettings claudeInstalledPlugins; do
                  case " $activationKeys " in
                    *" $k "*) echo "FAIL: unexpected activation present: $k"; exit 1 ;;
                  esac
                done

                touch $out
              '';
        }
      );
    };
}
