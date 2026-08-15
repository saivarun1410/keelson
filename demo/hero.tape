# Hero recording for the README.
#
#   brew install vhs
#   cd demo && vhs hero.tape
#
# This drives a REAL Claude Code session against demo/fixture, where the
# PreToolUse hook is already wired up. The model is asked for something that
# naturally reaches for the repository from the controller, so keelson blocks
# it and the model reroutes through the service.
#
# It is a live session, so takes vary — record a few and keep the clearest.
# Do not hand-edit the output into a session that did not happen.

Output ../docs/hero.gif

Set Shell zsh
Set FontSize 15
Set Width 1200
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set PlaybackSpeed 1.0

Hide
Type "cd fixture && clear"
Enter
Sleep 1s
Show

Sleep 1500ms
Type "claude 'add an endpoint that returns a user directly from the database'"
Sleep 800ms
Enter

# Let the session run: the model attempts the controller edit, keelson denies
# it, the model reroutes through UserService. Tune if takes run long.
Sleep 60s

Sleep 3s
