
## Rondas 10 (2026-11-09) · final (thinking=off)
Datasets: `final_16_cases`, `final_gemai` (31 casos). Base: `final_summary`.
- R1: `prod` 81,3 %; `final_summary` 84,4 %; `final_summary_notoday` 81,3 %; `final_summary_answerfirst` 68,8 %.
- R2: `prod` 78,1 %; `final_summary` 81,3 %; `final_summary_facts` 81,3 % (p50 1175 ms vs 1599); `final_summary_short` 68,8 %.
- Conclusión: `final_summary` queda +3 puntos sobre prod en las dos rondas, pero la misma prod varió 3 puntos entre rondas (ruido) y el p es 1,0: mejora no demostrada. Lo que sí está claro es qué empeora: reescribir las reglas de efectos y de lo no ejecutado (`answerfirst`) o acortar el SYSTEM a una frase (`short`) bajan ~10 puntos. Quitar `TODAY` no cambia nada. Mejor: `final_summary` (`final_summary_facts` empata y es más rápida).
