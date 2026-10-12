; Countdown — loop with branch
; Demonstrates: ADD, BRp (branch if positive), OUT, HALT

.ORIG x3000

  AND R0, R0, #0      ; clear R0
  ADD R0, R0, #9      ; R0 = 9 (start counter)

LOOP
  ADD R1, R0, #0      ; R1 = R0 (copy counter)
  LD  R2, ASCII       ; R2 = ASCII '0'
  ADD R1, R1, R2      ; R1 = counter + '0' = ASCII digit
  ; Use OUT trick: move to R0, print, restore
  ADD R3, R0, #0      ; save counter in R3
  ADD R0, R1, #0      ; R0 = ASCII digit
  OUT                 ; print the digit
  LD  R0, NEWLINE     ; R0 = newline character
  OUT                 ; print newline
  ADD R0, R3, #0      ; restore counter
  ADD R0, R0, #-1     ; decrement counter
  BRp LOOP            ; loop while R0 > 0

  HALT

ASCII   .FILL x0030   ; '0' = 0x30
NEWLINE .FILL x000A   ; '\n'

.END
