# Hero recording for the README.
#
#   brew install vhs && npm link
#   cd demo && vhs hero.tape
#
# Deterministic: no live model involved, so it records identically every time.
# It shows the actual mechanism — a clean repo, the edit an agent wants to make,
# and keelson refusing it with the reason the agent gets back.
#
# See live-session.tape for a recording of a real Claude Code session, which is
# more compelling but varies take to take.

Output ../docs/hero.gif

Set Shell zsh
Set FontSize 16
Set Width 1280
Set Height 400
Set Padding 28
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "cd fixture && clear"
Enter
Sleep 1s
Show

Sleep 1200ms

# 1. The repo is clean today.
Type "keelson check"
Sleep 400ms
Enter
Sleep 2500ms

# 2. This is the edit the agent wants to make: import the repository
#    straight into the controller.
Type "jq -r '.tool_input.content' bad-edit.json | head -5"
Sleep 400ms
Enter
Sleep 3500ms

# 3. keelson refuses it, and this text is what the agent reads back.
Type "keelson hook < bad-edit.json | jq -r .hookSpecificOutput.permissionDecisionReason"
Sleep 400ms
Enter
Sleep 5s
