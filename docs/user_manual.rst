User Manual
===========

Simplicial has one shape, on three pages.

Setup
-----

A 2D/3D scene of things, their settings and how they connect.

.. note:: Not written yet: the Station page, picking and editing a station object, properties.

Flow
----

A node graph that turns the setup into results.

Wires run square round the blocks. Wires that leave one output run as one line and branch off it,
with a dot at each branch point. To take a signal to another input, drag from its output again,
or pull a branch out of any of its wires: Ctrl-drag (or right-drag) the wire onto the input.
**Arrange** lays the blocks out left to right along their wires; a feedback wire runs back below them,
branching off its output's line like any other.

A number setting takes a number, a variable's name or a formula of them (``kp / 5``), as you type it.
Typing a name lists the variables it may mean, each with its type and value, and ↓ with no name typed
lists them all (the one taken replaces the value): ↑ ↓ to pick one, Tab, Enter or a click to take it,
Esc to hide the list (twice: to undo the edit). Leaving the setting, by Enter or a click elsewhere,
sets it. A setting bound to a variable shows its name in an outline. Point at a variable in the **Variables** card to see the blocks that use it
(a subsystem is marked when a block inside it does); click anywhere outside an open variable to fold it.

**Julix's variables.** While Julix runs on this computer, its session's variables show in the
**Variables** card under **From Julix**, read-only, as they were when its last run ended: numbers,
booleans, text, and arrays as a ``matrix`` by its rows (a vector is a column), up to 4096 values (a
larger one says so, and has no value to use). A setting binds to one like to any variable, and a run
takes the value Julix has then. A name the flow has itself is the flow's (its Julix row is greyed):
Julix fills in only what the flow doesn't define, as MATLAB's workspace does under a Simulink model's.
They are never saved in the flow file, and they go when Julix closes. With more than one Julix window open, the
card has the variables of each, a name in the latest run's over the same name in another's.

**Add block**, in the Flow's head, opens the block library: every block the station offers, as a card
with its name, its kind, what it does and its ports (inputs → outputs), its packages (Base, Signal,
Math, …, then installed toolkits) down the left. Type to search names, descriptions, ports and params.
Arrows choose a card, Enter or a click adds it in the middle of the Flow, or drag it onto the canvas:
dropped on a wire it fits, it goes into the wire; near a free port, it is wired to it. Esc closes. Optional
toolkits that aren't installed are listed under **Not installed**, with their blocks and how to install
them. To add a block where you are, press ``/`` or double-click the canvas: quick add, a search at the
cursor.

.. note:: Not written yet: the Graph view.

Run
---

Live monitoring: progress, plots and logs.

**Run settings.** Run › Run settings… says how the next run goes: its **length** (0 runs until
cancelled), its **speed** (times real time, or as fast as it can; during a run, a new speed changes
the run at once) and its **clock step** (how often blocks run and monitors sample), then the
**solver** every block and station object whose own solver is auto integrates with, and that
solver's options (the tolerances and steps of RK45, CVODE and IDA; the sub-steps of RK4, RK2 and
Euler). Each row says what the station's default is; a change applies as made, and the flow keeps
only what differs from its station in its file. **Reset to the station's** drops them all. The run
dock's length and speed are the same settings.

**Runtimes.** Run › Manage runtimes… opens the Paperboat Launcher on its Runtimes page, where the
Julia and Python stations run (``paperboat launcher --page runtimes``).

**Toolkits.** Run › Toolkits… (or **Toolkits…** in Settings › Simplicial, and on a toolkit the
block library lists as not installed) opens the package manager: **toolkits**, the optional
toolkits installed into the engine that serves the station, each with its version, Update when a
newer release is out, and × to remove it (not one the station needs); **registry**, every toolkit
``toolkits.toml`` lists, to search, read and add at a release (or ``dev``). Installing builds the
toolkit against the engine; the Console shows what it prints. **Restart station** brings its blocks
in.

.. note:: Not written yet: run styles (Signal, Step, Once), the run dock, endless runs and Cancel,
   Board tiles, run records.

Settings
--------

File › Settings… (Ctrl ,) opens one window with its pages in a rail; a change applies at once, with
no Save.

- **General**: the theme, Light, Dark or System (it follows your computer's), and the interface scale, Compact (75 %), Default or Large (125 %), which sizes text, icons and keys alike. Both
  apply to every Paperboat app and are the ones they all start in next time.
- **Simplicial**: **Station**, the one this window is on, with Choose a station… and Toolkits…; **Runs**, the
  station's run defaults, with Run settings… (what a flow changes is kept in its file); **Canvas**,
  the Flow's minimap in Navigator, on or off.
- **Hub**, while Simplicial works in a hub: its name and folder, Switch hub… and Close hub. The hub's
  own settings (its name, author and history) are set in Malachite.
- **Shortcuts**: every key, by menu, and the Flow canvas's.

Keyboard shortcuts
------------------

Help › Keyboard shortcuts (Ctrl /) opens Settings on Shortcuts, the full list. With something picked
on the Flow, Ctrl / comments it out instead. The ones you use most:

- Ctrl K: search the commands, blocks, variables, stations and examples (**Open example: <name>**
  opens one where it is; its banner's **copy it to <folder>** copies it to change it:
  :doc:`getting_started`); ``/`` or a double-click on the Flow: add a block there (the Flow's
  **Add block** opens the whole library).
- Ctrl N, Ctrl O, Ctrl Shift O, Ctrl S, Ctrl Shift S: new flow, open a file, open a folder, save,
  save as.
- Ctrl R: run; Esc: cancel the run.
- Alt 1, Alt 2, Alt 3: the Station, Flow and Board pages; Alt M: the next view mode.
- Ctrl Alt B: the Variables card; Ctrl J: the Board drawer (Commander); Ctrl \`: the Console.
- On the Flow canvas, ``?`` lists what the pointer and the keys do there.
