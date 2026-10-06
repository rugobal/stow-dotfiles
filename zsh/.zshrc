# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:/usr/local/bin:$PATH

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"

# Keep the Omarchy/Starship prompt instead of an Oh My Zsh theme.
ZSH_THEME=""

# Set list of themes to pick from when loading at random
# Setting this variable when ZSH_THEME=random will cause zsh to load
# a theme from this variable instead of looking in $ZSH/themes/
# If set to an empty array, this variable will have no effect.
# ZSH_THEME_RANDOM_CANDIDATES=( "robbyrussell" "agnoster" )

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to use hyphen-insensitive completion.
# Case-sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment one of the following lines to change the auto-update behavior
# zstyle ':omz:update' mode disabled  # disable automatic updates
# zstyle ':omz:update' mode auto      # update automatically without asking
# zstyle ':omz:update' mode reminder  # just remind me to update when it's time

# Uncomment the following line to change how often to auto-update (in days).
# zstyle ':omz:update' frequency 13

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS="true"

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# You can also set it to another string to have that shown instead of the default red dots.
# e.g. COMPLETION_WAITING_DOTS="%F{yellow}waiting...%f"
# Caution: this setting can cause issues with multiline prompts in zsh < 5.7.1 (see #5765)
# COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# You can set one of the optional three formats:
# "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# or set a custom format using the strftime function format specifications,
# see 'man strftime' for details.
# HIST_STAMPS="mm/dd/yyyy"

# Custom plugins/themes live in the stow repo, not inside ~/.oh-my-zsh.
if [[ -d "$HOME/stow-dotfiles/zsh/.oh-my-zsh/custom" ]]; then
  ZSH_CUSTOM="$HOME/stow-dotfiles/zsh/.oh-my-zsh/custom"
elif [[ -d "$HOME/dotfiles/zsh/.oh-my-zsh/custom" ]]; then
  ZSH_CUSTOM="$HOME/dotfiles/zsh/.oh-my-zsh/custom"
fi

# Which plugins would you like to load?
# Standard plugins can be found in $ZSH/plugins/
# Custom plugins may be added to $ZSH_CUSTOM/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
#
# Omitted on purpose:
#   z                      — Omarchy already provides zoxide (and a `z` command)
#   zsh-syntax-highlighting — omarchy-zsh loads this last so every widget is highlighted
plugins=(git extract kubectl zsh-autosuggestions)

source "$ZSH/oh-my-zsh.sh"

# OMZ git aliases collide with Omarchy worktree helpers (ga/gd).
unalias ga gd 2>/dev/null

# Omarchy: options, completion, aliases, mise, zoxide, fzf, and Starship prompt.
[[ -f /usr/share/omarchy-zsh/shell/zoptions ]] && source /usr/share/omarchy-zsh/shell/zoptions
[[ -f /usr/share/omarchy-zsh/shell/all ]] && source /usr/share/omarchy-zsh/shell/all

# User configuration

# export MANPATH="/usr/local/man:$MANPATH"

# You may need to manually set your language environment
# export LANG=en_US.UTF-8

# Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='mvim'
# fi

# Compilation flags
# export ARCHFLAGS="-arch x86_64"

# Set personal aliases, overriding those provided by oh-my-zsh libs,
# plugins, and themes. Aliases can be placed here, though oh-my-zsh
# users are encouraged to define aliases within the ZSH_CUSTOM folder.
# For a full list of active aliases, run `alias`.
#
# Example aliases
# alias zshconfig="mate ~/.zshrc"
# alias ohmyzsh="mate ~/.oh-my-zsh"

# Generated for envman. Do not edit.
[ -s "$HOME/.config/envman/load.sh" ] && source "$HOME/.config/envman/load.sh"

# THIS MUST BE AT THE END OF THE FILE FOR SDKMAN TO WORK!!!
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]] && source "$HOME/.sdkman/bin/sdkman-init.sh"

# # >>> conda initialize >>>
# # !! Contents within this block are managed by 'conda init' !!
# if [[ -x /opt/anaconda3/bin/conda ]]; then
#   __conda_setup="$('/opt/anaconda3/bin/conda' 'shell.zsh' 'hook' 2> /dev/null)"
#   if [ $? -eq 0 ]; then
#     eval "$__conda_setup"
#   else
#     if [ -f "/opt/anaconda3/etc/profile.d/conda.sh" ]; then
#       . "/opt/anaconda3/etc/profile.d/conda.sh"
#     else
#       export PATH="/opt/anaconda3/bin:$PATH"
#     fi
#   fi
#   unset __conda_setup
# fi
# # <<< conda initialize <<<

# >>> conda initialize >>>
# !! Contents within this block are managed by 'conda init' !!
__conda_setup="$('/home/rugobal/miniconda3/bin/conda' 'shell.zsh' 'hook' 2> /dev/null)"
if [ $? -eq 0 ]; then
    eval "$__conda_setup"
else
    if [ -f "/home/rugobal/miniconda3/etc/profile.d/conda.sh" ]; then
        . "/home/rugobal/miniconda3/etc/profile.d/conda.sh"
    else
        export PATH="/home/rugobal/miniconda3/bin:$PATH"
    fi
fi
unset __conda_setup
# <<< conda initialize <<<

# ASDF setup
[ -f "$HOME/.asdf/asdf.sh" ] && . "$HOME/.asdf/asdf.sh"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# Set the keybinding to Emacs mode
# This is to be able to use:
# Ctrl+a: Move to the beginning of the line
# Ctrl+e: Move to the end of the line
# Ctrl+k: Delete from the cursor to the end of the line
# Ctrl+u: Delete from the cursor to the beginning of the line
bindkey -e

# Bind Alt+k to delete from cursor to end of line without overriding Tab completion (^I)
bindkey '^[k' kill-line

# Bind Ctrl+u to delete from cursor to beginning of line
bindkey '^u' backward-kill-line

export PATH="$PATH:/opt/nvim-linux64/bin:$HOME/.cargo/bin"
[[ -d /home/rugobal/.dotfiles ]] && alias config='/usr/bin/git --git-dir=/home/rugobal/.dotfiles/ --work-tree=/home/rugobal'
# Ensure aliases use underlying command completion
setopt complete_aliases

# >>> Codex installer >>>
export PATH="/home/rugobal/.local/bin:$PATH"
# <<< Codex installer <<<

# opencode
export PATH=/home/rugobal/.opencode/bin:$PATH

# Added by the Hunk installer (https://hunk.dev)
export PATH='/home/rugobal/.hunk/bin':"$PATH"

# bun completions
[ -s "/home/rugobal/.bun/_bun" ] && source "/home/rugobal/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
