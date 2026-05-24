{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.claude-code;

  # Placeholder hook scripts. Real bodies (zellij-aware statusline + Stop /
  # UserPromptSubmit tab-rename hooks) are wired in Task 6 of the bootstrap
  # plan; for now empty scripts keep the settings.json structure valid so
  # `cfg.zellijIntegration.enable` already takes the right shape.
  statusLineScript = pkgs.writeShellScript "claude-statusline" "";
  onStopScript = pkgs.writeShellScript "claude-on-stop" "";
  onUserPromptScript = pkgs.writeShellScript "claude-on-user-prompt" "";

  baseSettings = {
    effortLevel = "high";
    voiceEnabled = true;
    skipDangerousModePermissionPrompt = true;
    skipAutoPermissionPrompt = true;
    permissions.defaultMode = "auto";
    env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
  };

  zellijBlock = {
    statusLine = {
      type = "command";
      command = "${statusLineScript}";
    };
    hooks = {
      Stop = [
        { hooks = [ { type = "command"; command = "${onStopScript}"; } ]; }
      ];
      UserPromptSubmit = [
        { hooks = [ { type = "command"; command = "${onUserPromptScript}"; } ]; }
      ];
    };
  };

  pluginsBlock = {
    enabledPlugins = cfg.extraEnabledPlugins;
    extraKnownMarketplaces = cfg.extraKnownMarketplaces;
  };

  mergedSettings = lib.foldl' lib.recursiveUpdate baseSettings (
    lib.optional cfg.zellijIntegration.enable zellijBlock
    ++ [
      pluginsBlock
      cfg.extraSettings
    ]
  );

  settingsFile = pkgs.writeText "claude-settings.json" (builtins.toJSON mergedSettings);
in
{
  # Home-manager ships its own `programs.claude-code` module with a
  # different option surface. Disable it so this module's options win.
  disabledModules = [ "programs/claude-code.nix" ];

  options.programs.claude-code = {
    enable = lib.mkEnableOption "user-level Claude Code configuration";

    installPackage = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Whether to install the Claude Code CLI itself via `home.packages`.
        Wired in Task 8 of the bootstrap plan.
      '';
    };

    contentRepoPath = lib.mkOption {
      type = lib.types.str;
      default = "${config.home.homeDirectory}/.claude-shared";
      description = ''
        Filesystem path to a writable clone of the claude-shared content
        repository. The skills / agents / commands directories under
        `~/.claude` will be symlinked into this path.
      '';
    };

    zellijIntegration.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Install the zellij-aware statusline plus Stop / UserPromptSubmit
        hooks that rename the current zellij tab so completion is visible
        across tabs.
      '';
    };

    userClaudeMd = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = ''
        Path to a user-level `CLAUDE.md` to symlink as `~/.claude/CLAUDE.md`.
        When null, no user-level CLAUDE.md is written.
      '';
    };

    extraSettings = lib.mkOption {
      type = lib.types.attrs;
      default = { };
      description = ''
        Extra attributes recursively merged into `~/.claude/settings.json`,
        applied last so they override base and zellij defaults.
      '';
    };

    extraEnabledPlugins = lib.mkOption {
      type = lib.types.attrs;
      default = { };
      description = ''
        Map of enabled plugins, e.g. `{ "revdiff@revdiff" = true; }`.
        Written into `settings.json` as `enabledPlugins`.
      '';
    };

    extraKnownMarketplaces = lib.mkOption {
      type = lib.types.attrs;
      default = { };
      description = ''
        Map of plugin marketplaces registered with Claude Code.
        Written into `settings.json` as `extraKnownMarketplaces`.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    home.activation.claudeSettings = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
      mkdir -p "$HOME/.claude"
      CC_NEW=$(${pkgs.coreutils}/bin/sha256sum ${settingsFile} | ${pkgs.coreutils}/bin/cut -d" " -f1)
      CC_CUR=$(${pkgs.coreutils}/bin/sha256sum "$HOME/.claude/settings.json" 2>/dev/null | ${pkgs.coreutils}/bin/cut -d" " -f1 || true)
      if [ "$CC_NEW" != "$CC_CUR" ]; then
        install -m 644 ${settingsFile} "$HOME/.claude/settings.json"
      fi
    '';
  };
}
