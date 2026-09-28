package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"time"
)

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for sc.Scan() {
		line := sc.Text()
		n, err := strconv.ParseInt(line, 10, 64)
		if err != nil {
			fmt.Fprintf(w, "ERR\n")
			continue
		}
		d := time.Duration(n)
		fmt.Fprintf(w, "%s\n", d.String())
	}
}
