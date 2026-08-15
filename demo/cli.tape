# Deterministic fallback recording: the CLI side, no live model involved.
# Use this for the "Commands" section of the README, or as the hero if the
# live session recording proves too noisy.
#
#   brew install vhs
#   cd demo && vhs cli.tape

Output ../docs/cli.gif

Set Shell zsh
Set FontSize 15
Set Width 1200
Set Height 640
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms

Hide
Type "cd fixture && clear"
Enter
Sleep 1s
Show

Sleep 1s
Type "keelson check"
Sleep 500ms
Enter
Sleep 3s

Type "clear"
Enter
Sleep 500ms

# Show the hook denying a controller -> repository edit.
Type "cat bad-edit.json | keelson hook | jq -r .hookSpecificOutput.permissionDecisionReason"
Sleep 500ms
Enter
Sleep 4s
