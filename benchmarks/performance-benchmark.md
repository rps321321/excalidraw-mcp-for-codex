# Scene Performance Benchmark

Measured with `npm run bench:scenes`.

| Elements | Create ms | Dagre layout ms | Patch ms | Scene export ms | Heap MB | Layout updates |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 3.72 | 23 | 3.39 | 0.27 | 10.61 | 100 |
| 500 | 7.88 | 49.47 | 26.48 | 1.14 | 23.75 | 500 |
| 1000 | 13.51 | 114.8 | 51.86 | 2.39 | 47.1 | 1000 |
| 5000 | 69.89 | 659.43 | 354.32 | 12.41 | 42.75 | 5000 |
