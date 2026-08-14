# Display-Only Add-On

`bushidoyasu_flow_signal_display_v1_0.jar`, built from
`src/main/java/jp/bushido/bookmap/FlowSignalDisplay.java`.

It draws the same markers as the research module and keeps nothing: no file, no
socket, no clipboard, no history beyond the engine's own windows. The build
packages it without `FlowCollector` and `FlowSignalResearch`, and `test.sh`
checks the module's constant pool for file, network, clipboard and process APIs
rather than taking the claim on trust - adding a single `Files.writeString` to it
fails the build.

## Why it exists

Bookmap marks an instrument `isApiProtected` and then refuses most API modules
on it. Both existing modules write evidence files, so nothing in the current
record separates "modules that export data are refused" from "third-party
modules are refused". This one exports nothing, so attaching it to a protected
instrument answers that:

- admitted where the others are not -> output is the boundary, and display-only
  work can continue on protected instruments
- refused as well -> the boundary is the module itself, and no restraint inside
  the add-on will change it

## What it deliberately does not have

`@UnrestrictedData`. The annotation exists to lift data restrictions, and the
note this file replaced reserved it for a build that has been through the
Developer Agreement and Bookmap's approval. Adding it now would test whether the
exception works rather than whether output is the boundary, using an exception
nobody granted. If the display JAR is refused too, that is the point to ask
Bookmap - with a specific question rather than a general one.

Whether recording a licensed feed to disk is permitted at all is a subscription
question, not a technical one, and is unresolved.
