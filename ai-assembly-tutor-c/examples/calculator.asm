; Calculator — add two single-digit numbers from keyboard input
; Demonstrates: GETC, OUT, ADD, PUTS, IN traps, I/O

.ORIG x3000

  LEA R0, PROMPT1     ; print "Enter first digit: "
  PUTS
  GETC                ; read character into R0
  OUT                 ; echo it
  LD R3, NEGASCII     ; R3 = -48 (negate ASCII '0')
  ADD R1, R0, R3      ; R1 = numeric value of first digit

  LD R0, NEWLINE
  OUT                 ; print newline

  LEA R0, PROMPT2     ; print "Enter second digit: "
  PUTS
  GETC                ; read character into R0
  OUT                 ; echo it
  ADD R2, R0, R3      ; R2 = numeric value of second digit

  LD R0, NEWLINE
  OUT

  ADD R0, R1, R2      ; R0 = sum
  ST  R0, RESULT      ; store the result

  LEA R0, MSG         ; print "Sum = "
  PUTS

  LD R0, RESULT       ; load sum
  LD R3, POSASCII     ; R3 = 48 (ASCII '0')
  ADD R0, R0, R3      ; convert to ASCII
  OUT                 ; print sum digit

  LD R0, NEWLINE
  OUT

  HALT

PROMPT1  .STRINGZ "Enter first digit: "
PROMPT2  .STRINGZ "Enter second digit: "
MSG      .STRINGZ "Sum = "
NEGASCII .FILL xFFD0  ; -48
POSASCII .FILL x0030  ; 48
NEWLINE  .FILL x000A
RESULT   .BLKW 1

.END
