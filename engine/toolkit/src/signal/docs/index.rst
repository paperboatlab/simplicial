signal
======

Signals f(t). ``t`` is the block's input ``t`` when wired (a step's ``progress``, so the signal
follows the step's own time), else the run clock. All output ``y`` except ``clock`` (out ``t``).

.. toctree::
   :maxdepth: 1

   blocks/index

Generators
----------

In C++ there are ``clock``, ``fft`` and ``generator``, the abstract parent: f is an expression
(config ``f``) over ``t`` and the definition's number params. The rest are defined on it in TOML
(``engine/toolkit/src/signal/blocks.toml``), and a descriptor defines more the same way:

.. code-block:: toml

   [[blocks]]
   use = "signal/generator"
   type = "sine"
   label = "Sine"
   params = { amplitude = 1, frequency = 1, phase = 0, offset = 0 }
   config = { f = "offset + amplitude * sin(2 * pi * frequency * t + phase)" }

Expressions
-----------

Numbers, names, ``+ - * / % ^``, comparisons (1 or 0), ``&& || !``, ``c ? a : b``, ``pi``, ``e`` and
``sin cos tan asin acos atan atan2 sinh cosh tanh exp log log10 sqrt abs floor ceil round sign
frac min max clamp mod pow``.
