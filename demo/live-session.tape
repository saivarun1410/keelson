# Optional upgrade over hero.tape: a recording of a REAL Claude Code session.
#
#   brew install vhs
#   cd demo && vhs live-session.tape
#
# The fixture has the PreToolUse hook already wired up. The model is asked for
# something that naturally reaches from the controller into the repository, so
# keelson denies the edit and the model reroutes through UserService.
#
# This is a live session, so takes vary — record several and keep the clearest.
# Never hand-edit the output into a session that did not happen.

Output ../docs/live-session.gif

Set Shell zsh
Set FontSize 15
Set Width 1200
Set Height 760
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms

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
# it, the model reroutes through the service. Tune if takes run long.
Sleep 90s
Sleep 3s
