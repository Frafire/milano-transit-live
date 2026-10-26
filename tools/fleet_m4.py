"""Real M4 fleet (Giovanni, Oct 2026): 47 driverless 4-car trains, all in service."""
BUILT = {**{n: 2019 for n in [4401]}, **{n: 2020 for n in [4402, 4403]},
         **{n: 2021 for n in range(4404, 4428)}, **{n: 2022 for n in range(4428, 4446)}, **{n: 2023 for n in [4446, 4447]}}
SINCE = {**{n: '26/11/2022' for n in range(4401, 4406)}, **{n: '04/07/2023' for n in range(4406, 4415)},
         **{n: '07/08/2024' for n in range(4415, 4448)}}
def trains():
    return [{'units': str(n), 'type': 'Hitachi Rail driverless, 4 casse', 'year': str(BUILT[n]),
             'display': '', 'note': 'in servizio dal ' + SINCE[n]} for n in range(4401, 4448)], None
