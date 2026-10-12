; Fibonacci — compute first N Fibonacci numbers
; Demonstrates: register manipulation, loops, ADD, ST, LD

.ORIG x3000

  AND R0, R0, #0      ; R0 = fib(n-2) = 0
  ADD R1, R0, #1      ; R1 = fib(n-1) = 1
  AND R3, R3, #0
  ADD R3, R3, #10     ; R3 = counter (compute 10 values)

FIBLOOP
  ADD R2, R0, R1      ; R2 = fib(n) = fib(n-2) + fib(n-1)
  ADD R0, R1, #0      ; shift: fib(n-2) = old fib(n-1)
  ADD R1, R2, #0      ; shift: fib(n-1) = fib(n)
  ADD R3, R3, #-1     ; decrement counter
  BRp FIBLOOP         ; loop while counter > 0

  ; R1 now holds fib(12) = 144 (x0090)
  HALT

.END
