#!/usr/bin/env bash
# Wspólna logika prep Trellis — źródło prawdy dla island-prune per auto.
# Island-prune bezpieczny tylko dla muscle/truck/buggy/hatch (kompaktowy mesh).
# sleek/blade/phantom — NIE (prune zostawia ~25% meshu = dziury w karoserii).

FLYBALL_PRUNE_CARS="${FLYBALL_PRUNE_CARS:-muscle,truck,buggy,hatch}"

flyball_car_should_prune() {
	local car="$1"
	[[ ",${FLYBALL_PRUNE_CARS}," == *",${car},"* ]]
}

flyball_prune_flag_for_car() {
	if flyball_car_should_prune "$1"; then
		echo 1
	else
		echo 0
	fi
}
