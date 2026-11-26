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
Typing a name lists the variables it may mean, each with its type and value: ↑ ↓ to pick one, Tab or
Enter to take it, Esc to hide the list (twice: to undo the edit). A setting bound to a variable shows
its name in an outline. Point at a variable in the **Variables** card to see the blocks that use it
(a subsystem is marked when a block inside it does); click anywhere outside an open variable to fold it.

.. note:: Not written yet: placing blocks, the Graph view.

Run
---

Live monitoring: progress, plots and logs.

.. note:: Not written yet: run styles (Signal, Step, Once), the run dock, endless runs and Cancel,
   Board tiles, run records.

Keyboard shortcuts
------------------

.. note:: Not written yet.
