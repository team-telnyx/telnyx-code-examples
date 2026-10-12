; Add Numbers — basic arithmetic with ADD
; Demonstrates: AND (clear), ADD immediate, ADD register, HALT

.ORIG x3000

  AND R0, R0, #0      ; R0 = 0  (clear register)
  ADD R0, R0, #7      ; R0 = 7
  AND R1, R1, #0      ; R1 = 0
  ADD R1, R1, #3      ; R1 = 3
  ADD R2, R0, R1      ; R2 = R0 + R1 = 10
  HALT

.END
