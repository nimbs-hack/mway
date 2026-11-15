# Crew portraits

Put one image per crew member here, using their name in lower case: `jessica meir.svg` for Jessica Meir. JPEG, PNG, WebP, AVIF and SVG work. A crew member with no file shows the first two letters of the name.

The examples use real NASA astronaut names and portraits. Their mission roles, ages, measurements and other planning inputs are fictional and do not describe the pictured astronauts. NASA and the astronauts do not endorse this app.

## Sources

These replace the former movie portraits. Each file embeds an unchanged JPEG from NASA's Image and Video Library. Its SVG viewBox frames the face for a square avatar. No face is generated or retouched.

| Astronaut | NASA source | Credit |
| --- | --- | --- |
| Christina Koch | [jsc2018e095073_alt](https://images.nasa.gov/details/jsc2018e095073_alt) | NASA/Bill Stafford |
| Robert Hines | [jsc2021e018898_alt](https://images.nasa.gov/details/jsc2021e018898_alt) | NASA/Josh Valcarcel |
| Jessica Meir | [jsc2025e078605_alt](https://images.nasa.gov/details/jsc2025e078605_alt) | NASA/Josh Valcarcel |
| Victor Glover | [NHQ202009150002](https://images.nasa.gov/details/NHQ202009150002) | NASA/Bill Ingalls |
| Kjell Lindgren | [jsc2021e018841_alt](https://images.nasa.gov/details/jsc2021e018841_alt) | NASA/Josh Valcarcel |
| Jessica Watkins | [jsc2026e035015_alt](https://images.nasa.gov/details/jsc2026e035015_alt) | NASA/Bill Stafford |
| Frank Rubio | [jsc2017e114795](https://images.nasa.gov/details/jsc2017e114795) | NASA/Bill Stafford |
| Kathleen Rubins | [jsc2010e008396](https://images.nasa.gov/details/jsc2010e008396) | NASA/Robert Markowitz |

NASA-created media generally is not subject to copyright in the United States. Educational and informational reuse must credit NASA and avoid implied endorsement. This does not waive a person's publicity or privacy rights for commercial uses. See [NASA's media-use guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/), checked November 15, 2026.

The download URLs, image dimensions and display crops are in [sources.json](sources.json). Restore the assets with `bun scripts/fetch-crew-portraits.ts`. Keep one file per name so the lookup is unambiguous.
