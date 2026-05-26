{
  config,
  lib,
  pkgs,
  inputs,
  ...
}:
let
  cfg = config.programs.claude-code;

  # Zellij-aware statusline + Stop / UserPromptSubmit hooks. Inlined here
  # (rather than `builtins.readFile ./*.sh`) so `${pkgs.jq}` and
  # `${pkgs.zellij}` get nixpkgs string interpolation. Only wired into
  # `settings.json` when `cfg.zellijIntegration.enable` is true.
  statusLineScript = pkgs.writeShellScript "claude-statusline" ''
    set -eu
    input=$(cat)
    model=$(${pkgs.jq}/bin/jq -r '.model.display_name // "claude"' <<<"$input")
    cwd=$(${pkgs.jq}/bin/jq -r '.workspace.current_dir // .cwd // "?"' <<<"$input")
    cwd_short="''${cwd/#$HOME/~}"
    prefix=""
    if [ -n "''${ZELLIJ_SESSION_NAME:-}" ]; then
      prefix=$(printf '\033[35mzj:%s\033[0m ' "$ZELLIJ_SESSION_NAME")
    fi
    printf '%b\033[36m%s\033[0m  \033[33m%s\033[0m' "$prefix" "$model" "$cwd_short"
  '';

  onStopScript = pkgs.writeShellScript "claude-on-stop" ''
    [ -n "''${ZELLIJ:-}" ] || exit 0
    ${pkgs.zellij}/bin/zellij action rename-tab "✓ claude" 2>/dev/null || true
  '';

  onUserPromptScript = pkgs.writeShellScript "claude-on-user-prompt" ''
    [ -n "''${ZELLIJ:-}" ] || exit 0
    ${pkgs.zellij}/bin/zellij action rename-tab "claude" 2>/dev/null || true
  '';

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
        {
          hooks = [
            {
              type = "command";
              command = "${onStopScript}";
            }
          ];
        }
      ];
      UserPromptSubmit = [
        {
          hooks = [
            {
              type = "command";
              command = "${onUserPromptScript}";
            }
          ];
        }
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

  pluginsDir = "${config.home.homeDirectory}/.claude/plugins";

  installedPluginsContent = {
    version = 2;
    plugins = lib.mapAttrs (
      name: _enabled:
      let
        parts = lib.splitString "@" name;
        marketplace = lib.last parts;
      in
      [
        {
          scope = "user";
          installPath = "${pluginsDir}/marketplaces/${marketplace}";
        }
      ]
    ) cfg.extraEnabledPlugins;
  };

  installedPluginsFile = pkgs.writeText "claude-installed-plugins.json" (
    builtins.toJSON installedPluginsContent
  );

  managePlugins = cfg.extraEnabledPlugins != { } || cfg.extraKnownMarketplaces != { };

  pluginNameAssertions = lib.mapAttrsToList (name: _: {
    assertion = builtins.match "[^@]+@[^@]+" name != null;
    message = ''
      programs.claude-code.extraEnabledPlugins key "${name}" must be in
      "plugin@marketplace" format (e.g. "revdiff@revdiff"). Without an `@`,
      the marketplace cannot be inferred and installed_plugins.json will be
      misconfigured.
    '';
  }) cfg.extraEnabledPlugins;

  # Granular per-item symlinks: enumerate skills/agents/commands at eval
  # time from the flake's own source tree, then create one mkOutOfStoreSymlink
  # per entry. This lets other HM modules contribute their own files into
  # ~/.claude/skills/, ~/.claude/agents/, ~/.claude/commands/ without
  # colliding with a whole-directory symlink.
  contentSrc = ./../content;

  dirNames =
    sub:
    lib.attrNames (lib.filterAttrs (_: t: t == "directory") (builtins.readDir "${contentSrc}/${sub}"));

  fileNames =
    sub:
    lib.attrNames (lib.filterAttrs (_: t: t == "regular") (builtins.readDir "${contentSrc}/${sub}"));

  mkSymlinkEntry = subdir: name: {
    name = ".claude/${subdir}/${name}";
    value.source = config.lib.file.mkOutOfStoreSymlink "${cfg.contentRepoPath}/content/${subdir}/${name}";
  };

  contentSymlinks = builtins.listToAttrs (
    (map (mkSymlinkEntry "skills") (dirNames "skills"))
    ++ (map (mkSymlinkEntry "agents") (fileNames "agents"))
    ++ (map (mkSymlinkEntry "commands") (fileNames "commands"))
  );
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
        Whether to install the Claude Code CLI itself via `home.packages`
        from the `claude-code` flake input.
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

  # Default for `inputs` so the module evaluates without the flake wrapper
  # (e.g. when imported directly in a test harness with `installPackage = false`).
  # The flake's `homeManagerModules.default` overrides this with the real inputs.
  config = lib.mkMerge [
    { _module.args.inputs = lib.mkDefault null; }
    (lib.mkIf cfg.enable (
      lib.mkMerge [
        {
          home.file = contentSymlinks;

          home.activation.claudeSharedClone = lib.hm.dag.entryBefore [ "writeBoundary" ] ''
            if [ ! -d "${cfg.contentRepoPath}" ]; then
              ${pkgs.git}/bin/git clone https://github.com/alexandru-savinov/claude-shared.git "${cfg.contentRepoPath}" \
                || { echo "WARNING: claude-shared clone failed" >&2; true; }
            else
              ${pkgs.git}/bin/git -C "${cfg.contentRepoPath}" pull --ff-only \
                || { echo "WARNING: claude-shared pull failed" >&2; true; }
            fi
          '';

          home.activation.claudeSettings = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
            mkdir -p "$HOME/.claude"
            CC_NEW=$(${pkgs.coreutils}/bin/sha256sum ${settingsFile} | ${pkgs.coreutils}/bin/cut -d" " -f1)
            CC_CUR=$(${pkgs.coreutils}/bin/sha256sum "$HOME/.claude/settings.json" 2>/dev/null | ${pkgs.coreutils}/bin/cut -d" " -f1 || true)
            if [ "$CC_NEW" != "$CC_CUR" ]; then
              install -m 644 ${settingsFile} "$HOME/.claude/settings.json"
            fi
          '';
        }
        (lib.mkIf managePlugins {
          assertions = pluginNameAssertions;
          home.activation.claudeInstalledPlugins = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
            mkdir -p "${pluginsDir}"
            CC_NEW=$(${pkgs.coreutils}/bin/sha256sum ${installedPluginsFile} | ${pkgs.coreutils}/bin/cut -d" " -f1)
            CC_CUR=$(${pkgs.coreutils}/bin/sha256sum "${pluginsDir}/installed_plugins.json" 2>/dev/null | ${pkgs.coreutils}/bin/cut -d" " -f1 || true)
            if [ "$CC_NEW" != "$CC_CUR" ]; then
              install -m 644 ${installedPluginsFile} "${pluginsDir}/installed_plugins.json"
            fi
          '';
        })
        (lib.mkIf cfg.installPackage {
          assertions = [
            {
              assertion = inputs != null && inputs ? claude-code;
              message = ''
                programs.claude-code.installPackage = true requires the
                `claude-code` flake input to be threaded through via
                `_module.args.inputs`. Import this module via
                `claude-shared.homeManagerModules.default` from its flake.
              '';
            }
          ];
          # Use `lib.optional` so a null `inputs` short-circuits to an empty
          # list; the assertion above surfaces the friendly error instead of
          # a cryptic "attempt to call something which is not a function".
          home.packages = lib.optional (
            inputs != null && inputs ? claude-code
          ) inputs.claude-code.packages.${pkgs.system}.default;
        })
        (lib.mkIf (cfg.userClaudeMd != null) {
          home.file.".claude/CLAUDE.md".source = cfg.userClaudeMd;
        })
      ]
    ))
  ];
}
