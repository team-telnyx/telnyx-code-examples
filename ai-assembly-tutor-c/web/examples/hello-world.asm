; Hello World — PUTS trap outputs a string
; Demonstrates: LEA, PUTS, HALT, .STRINGZ

.ORIG x3000

  LEA R0, HELLO       ; R0 = address of the string
  PUTS                ; print the string at R0
  HALT                ; stop the machine

HELLO .STRINGZ "Hello, world!"

.END
