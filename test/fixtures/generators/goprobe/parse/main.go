package main

import (
	"bufio"
	"fmt"
	"os"
	"time"
)

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for sc.Scan() {
		line := sc.Text()
		d, err := time.ParseDuration(line)
		if err != nil {
			fmt.Fprintf(w, "ERR\n")
		} else {
			fmt.Fprintf(w, "OK\t%d\n", int64(d))
		}
	}
}
