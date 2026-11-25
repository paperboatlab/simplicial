group
=====

A subsystem's or story's ports, as blocks inside it. ``inport`` (In) is an input: a port on the
group's block outside, and its value inside. ``outport`` (Out) is an output: what is wired to it
inside leaves by a port outside. Each port is named by the block's ``name`` (else In 1, Out 2… in
the order they stand inside, top to bottom). Both pass their value through unchanged, of any type.
Every station's catalog has them, without importing ``group``. See `Flows
<https://paperboatlab.github.io/paperboat/flow.html>`_.

.. toctree::
   :maxdepth: 1

   blocks/index
