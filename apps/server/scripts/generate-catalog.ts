/**
 * Generates apps/server/data/catalog.json - the offline movie catalog (no TMDB key needed).
 *   npm run catalog:generate
 * Rows are real, well-known titles with approximate metadata (years/runtimes/ratings are
 * plausible, not authoritative). Overviews are generated from genres + keywords.
 * The six open films are CC-licensed Blender Foundation movies with real public streams.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveMoods, hashString, type Movie, type StreamType } from '@willio/shared';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'catalog.json');

// title|year|runtime|rating|lang|genres|cast|keywords[|originalTitle]
const ROWS = `
Interstellar|2014|169|8.7|en|Sci-Fi;Adventure;Drama|Matthew McConaughey;Anne Hathaway;Jessica Chastain|space travel;black hole;time;fatherhood
Inception|2010|148|8.8|en|Sci-Fi;Action;Thriller|Leonardo DiCaprio;Joseph Gordon-Levitt;Elliot Page|dream;heist;memory;twist
The Dark Knight|2008|152|9.0|en|Action;Crime;Drama|Christian Bale;Heath Ledger;Aaron Eckhart|vigilante;chaos;gotham
The Prestige|2006|130|8.5|en|Mystery;Thriller;Drama|Hugh Jackman;Christian Bale;Scarlett Johansson|magician;rivalry;twist
Memento|2000|113|8.4|en|Mystery;Thriller|Guy Pearce;Carrie-Anne Moss|memory;revenge;amnesia
Dunkirk|2017|106|7.8|en|War;History;Drama|Fionn Whitehead;Tom Hardy;Mark Rylance|evacuation;survival;world war ii
Tenet|2020|150|7.3|en|Sci-Fi;Action;Thriller|John David Washington;Robert Pattinson|time;inversion;espionage
Oppenheimer|2023|180|8.3|en|History;Drama|Cillian Murphy;Emily Blunt;Robert Downey Jr.|atomic bomb;scientist;biography
The Matrix|1999|136|8.7|en|Sci-Fi;Action|Keanu Reeves;Laurence Fishburne;Carrie-Anne Moss|simulation;hacker;reality
The Matrix Reloaded|2003|138|7.2|en|Sci-Fi;Action|Keanu Reeves;Carrie-Anne Moss|simulation;machines;chosen one
Blade Runner|1982|117|8.1|en|Sci-Fi;Thriller|Harrison Ford;Rutger Hauer;Sean Young|android;dystopia;identity
Blade Runner 2049|2017|164|8.0|en|Sci-Fi;Drama;Mystery|Ryan Gosling;Harrison Ford;Ana de Armas|android;memory;identity
Arrival|2016|116|7.9|en|Sci-Fi;Drama;Mystery|Amy Adams;Jeremy Renner|aliens;language;time
Dune|2021|155|8.0|en|Sci-Fi;Adventure|Timothee Chalamet;Rebecca Ferguson;Zendaya|desert planet;prophecy;empire
Dune: Part Two|2024|166|8.5|en|Sci-Fi;Adventure;Action|Timothee Chalamet;Zendaya;Austin Butler|desert planet;revenge;prophecy
Gravity|2013|91|7.7|en|Sci-Fi;Thriller|Sandra Bullock;George Clooney|space;survival;astronaut
The Martian|2015|144|8.0|en|Sci-Fi;Adventure;Comedy|Matt Damon;Jessica Chastain|mars;survival;botany
Ex Machina|2014|108|7.7|en|Sci-Fi;Thriller;Drama|Alicia Vikander;Domhnall Gleeson;Oscar Isaac|artificial intelligence;turing test;identity
Her|2013|126|8.0|en|Romance;Sci-Fi;Drama|Joaquin Phoenix;Scarlett Johansson|artificial intelligence;loneliness;love
Edge of Tomorrow|2014|113|7.9|en|Sci-Fi;Action|Tom Cruise;Emily Blunt|time loop;aliens;soldier
Looper|2012|119|7.4|en|Sci-Fi;Action;Thriller|Joseph Gordon-Levitt;Bruce Willis;Emily Blunt|time travel;assassin
Minority Report|2002|145|7.6|en|Sci-Fi;Action;Mystery|Tom Cruise;Colin Farrell|precrime;future;conspiracy
Alien|1979|117|8.5|en|Horror;Sci-Fi|Sigourney Weaver;Tom Skerritt|spaceship;creature;survival
Aliens|1986|137|8.4|en|Sci-Fi;Action;Horror|Sigourney Weaver;Michael Biehn|marines;creature;colony
The Terminator|1984|107|8.1|en|Sci-Fi;Action|Arnold Schwarzenegger;Linda Hamilton|time travel;cyborg;chase
Terminator 2: Judgment Day|1991|137|8.6|en|Sci-Fi;Action|Arnold Schwarzenegger;Linda Hamilton;Edward Furlong|time travel;cyborg;apocalypse
Back to the Future|1985|116|8.5|en|Sci-Fi;Comedy;Adventure|Michael J. Fox;Christopher Lloyd|time travel;high school;inventor
Back to the Future Part II|1989|108|7.8|en|Sci-Fi;Comedy;Adventure|Michael J. Fox;Christopher Lloyd|time travel;future;paradox
E.T. the Extra-Terrestrial|1982|115|7.9|en|Family;Sci-Fi;Adventure|Henry Thomas;Drew Barrymore|alien;friendship;childhood
Close Encounters of the Third Kind|1977|138|7.6|en|Sci-Fi;Drama|Richard Dreyfuss;Francois Truffaut|ufo;obsession;contact
Jurassic Park|1993|127|8.2|en|Sci-Fi;Adventure;Thriller|Sam Neill;Laura Dern;Jeff Goldblum|dinosaurs;theme park;genetics
Avatar|2009|162|7.9|en|Sci-Fi;Adventure;Action|Sam Worthington;Zoe Saldana;Sigourney Weaver|alien world;colonialism;nature
Avatar: The Way of Water|2022|192|7.6|en|Sci-Fi;Adventure|Sam Worthington;Zoe Saldana|ocean;family;alien world
District 9|2009|112|7.9|en|Sci-Fi;Thriller;Action|Sharlto Copley;Jason Cope|aliens;apartheid;transformation
Children of Men|2006|109|7.9|en|Sci-Fi;Thriller;Drama|Clive Owen;Julianne Moore;Michael Caine|infertility;dystopia;refugee
Moon|2009|97|7.8|en|Sci-Fi;Mystery;Drama|Sam Rockwell;Kevin Spacey|clone;isolation;lunar base
Annihilation|2018|115|6.8|en|Sci-Fi;Horror;Mystery|Natalie Portman;Oscar Isaac|shimmer;mutation;expedition
Everything Everywhere All at Once|2022|139|7.8|en|Sci-Fi;Comedy;Action|Michelle Yeoh;Ke Huy Quan;Jamie Lee Curtis|multiverse;family;taxes
Eternal Sunshine of the Spotless Mind|2004|108|8.3|en|Romance;Sci-Fi;Drama|Jim Carrey;Kate Winslet|memory;breakup;love
Primer|2004|77|6.8|en|Sci-Fi;Thriller|Shane Carruth;David Sullivan|time travel;garage;paradox
Source Code|2011|93|7.5|en|Sci-Fi;Thriller;Mystery|Jake Gyllenhaal;Michelle Monaghan|time loop;train;bomb
Coherence|2013|89|7.2|en|Sci-Fi;Thriller;Mystery|Emily Baldoni;Maury Sterling|comet;parallel reality;dinner party
Star Wars|1977|121|8.6|en|Sci-Fi;Adventure;Action|Mark Hamill;Harrison Ford;Carrie Fisher|space opera;rebellion;the force
The Empire Strikes Back|1980|124|8.7|en|Sci-Fi;Adventure;Action|Mark Hamill;Harrison Ford;Carrie Fisher|space opera;father;the force
Return of the Jedi|1983|131|8.3|en|Sci-Fi;Adventure;Action|Mark Hamill;Harrison Ford;Carrie Fisher|space opera;redemption;the force
Rogue One|2016|133|7.8|en|Sci-Fi;Action;Adventure|Felicity Jones;Diego Luna|space opera;heist;rebellion
Star Trek|2009|127|7.7|en|Sci-Fi;Action;Adventure|Chris Pine;Zachary Quinto|starship;time travel;crew
Guardians of the Galaxy|2014|121|8.0|en|Sci-Fi;Action;Comedy|Chris Pratt;Zoe Saldana;Dave Bautista|space;misfits;mixtape
The Avengers|2012|143|8.0|en|Action;Sci-Fi;Adventure|Robert Downey Jr.;Chris Evans;Scarlett Johansson|superhero;team;invasion
Avengers: Infinity War|2018|149|8.4|en|Action;Sci-Fi;Adventure|Robert Downey Jr.;Chris Hemsworth;Josh Brolin|superhero;infinity stones;villain
Avengers: Endgame|2019|181|8.4|en|Action;Sci-Fi;Adventure|Robert Downey Jr.;Chris Evans;Mark Ruffalo|superhero;time travel;sacrifice
Iron Man|2008|126|7.9|en|Action;Sci-Fi;Adventure|Robert Downey Jr.;Gwyneth Paltrow|superhero;armor;billionaire
Black Panther|2018|134|7.3|en|Action;Adventure;Sci-Fi|Chadwick Boseman;Michael B. Jordan;Lupita Nyong'o|superhero;kingdom;legacy
Spider-Man: Into the Spider-Verse|2018|117|8.4|en|Animation;Action;Adventure|Shameik Moore;Jake Johnson;Hailee Steinfeld|multiverse;superhero;coming of age
Spider-Man: Across the Spider-Verse|2023|140|8.6|en|Animation;Action;Adventure|Shameik Moore;Hailee Steinfeld;Oscar Isaac|multiverse;superhero;destiny
Spider-Man 2|2004|127|7.5|en|Action;Adventure|Tobey Maguire;Kirsten Dunst;Alfred Molina|superhero;responsibility;new york
Logan|2017|137|8.1|en|Action;Drama;Sci-Fi|Hugh Jackman;Patrick Stewart;Dafne Keen|mutant;road trip;mentor
Joker|2019|122|8.4|en|Crime;Drama;Thriller|Joaquin Phoenix;Robert De Niro|mental illness;society;gotham
The Batman|2022|176|7.8|en|Crime;Mystery;Action|Robert Pattinson;Zoe Kravitz;Paul Dano|detective;serial killer;gotham
Batman Begins|2005|140|8.2|en|Action;Crime;Drama|Christian Bale;Michael Caine;Liam Neeson|origin;fear;vigilante
Wonder Woman|2017|141|7.3|en|Action;Adventure;Fantasy|Gal Gadot;Chris Pine|amazon;world war i;superhero
Mad Max: Fury Road|2015|120|8.1|en|Action;Adventure;Sci-Fi|Tom Hardy;Charlize Theron;Nicholas Hoult|wasteland;chase;rebellion
John Wick|2014|101|7.4|en|Action;Thriller;Crime|Keanu Reeves;Michael Nyqvist|assassin;revenge;dog
John Wick: Chapter 4|2023|169|7.7|en|Action;Thriller;Crime|Keanu Reeves;Donnie Yen;Bill Skarsgard|assassin;duel;paris
Mission: Impossible - Fallout|2018|147|7.7|en|Action;Thriller;Adventure|Tom Cruise;Henry Cavill;Rebecca Ferguson|spy;nuclear;stunts
Mission: Impossible - Ghost Protocol|2011|132|7.4|en|Action;Thriller;Adventure|Tom Cruise;Simon Pegg;Paula Patton|spy;kremlin;burj khalifa
Top Gun: Maverick|2022|130|8.2|en|Action;Drama|Tom Cruise;Miles Teller;Jennifer Connelly|fighter pilot;mentor;mission
Die Hard|1988|132|8.2|en|Action;Thriller|Bruce Willis;Alan Rickman|christmas;hostage;skyscraper
Speed|1994|116|7.3|en|Action;Thriller|Keanu Reeves;Sandra Bullock;Dennis Hopper|bus;bomb;hostage
The Bourne Identity|2002|119|7.9|en|Action;Thriller;Mystery|Matt Damon;Franka Potente|amnesia;spy;chase
The Bourne Ultimatum|2007|115|8.0|en|Action;Thriller;Mystery|Matt Damon;Julia Stiles|spy;conspiracy;chase
Casino Royale|2006|144|8.0|en|Action;Thriller;Adventure|Daniel Craig;Eva Green;Mads Mikkelsen|spy;poker;betrayal
Skyfall|2012|143|7.8|en|Action;Thriller;Adventure|Daniel Craig;Javier Bardem;Judi Dench|spy;mentor;revenge
Gladiator|2000|155|8.5|en|Action;Drama;History|Russell Crowe;Joaquin Phoenix|rome;revenge;arena
Braveheart|1995|178|8.3|en|History;War;Drama|Mel Gibson;Sophie Marceau|scotland;freedom;rebellion
Kingdom of Heaven|2005|144|7.2|en|Action;History;War|Orlando Bloom;Eva Green|crusades;jerusalem;knight
300|2006|117|7.6|en|Action;War;Fantasy|Gerard Butler;Lena Headey|sparta;battle;legend
Raiders of the Lost Ark|1981|115|8.4|en|Action;Adventure|Harrison Ford;Karen Allen|archaeology;treasure;nazis
Indiana Jones and the Last Crusade|1989|127|8.2|en|Action;Adventure|Harrison Ford;Sean Connery|archaeology;father;holy grail
Pirates of the Caribbean: The Curse of the Black Pearl|2003|143|8.1|en|Adventure;Fantasy;Action|Johnny Depp;Orlando Bloom;Keira Knightley|pirates;curse;treasure
The Mummy|1999|124|7.1|en|Adventure;Fantasy;Action|Brendan Fraser;Rachel Weisz|egypt;curse;treasure
Kill Bill: Vol. 1|2003|111|8.2|en|Action;Crime;Thriller|Uma Thurman;Lucy Liu;David Carradine|revenge;sword;assassin
Kill Bill: Vol. 2|2004|137|8.0|en|Action;Crime;Thriller|Uma Thurman;David Carradine|revenge;mother;assassin
The Raid|2011|101|7.6|id|Action;Thriller;Crime|Iko Uwais;Joe Taslim|martial arts;tower block;police
Crouching Tiger, Hidden Dragon|2000|120|7.9|zh|Action;Adventure;Romance|Chow Yun-fat;Michelle Yeoh;Zhang Ziyi|wuxia;sword;legend|Wo hu cang long
Hero|2002|120|7.9|zh|Action;Adventure;History|Jet Li;Tony Leung;Maggie Cheung|wuxia;assassin;emperor|Ying xiong
Ip Man|2008|106|8.0|zh|Action;Drama;History|Donnie Yen;Simon Yam|martial arts;wing chun;occupation
The Pursuit of Happyness|2006|117|8.0|en|Drama|Will Smith;Jaden Smith|father;poverty;ambition
The Shawshank Redemption|1994|142|9.3|en|Drama;Crime|Tim Robbins;Morgan Freeman|prison;hope;friendship
The Godfather|1972|175|9.2|en|Crime;Drama|Marlon Brando;Al Pacino;James Caan|mafia;family;power
The Godfather Part II|1974|202|9.0|en|Crime;Drama|Al Pacino;Robert De Niro;Robert Duvall|mafia;family;legacy
Goodfellas|1990|145|8.7|en|Crime;Drama|Ray Liotta;Robert De Niro;Joe Pesci|mafia;true story;loyalty
Pulp Fiction|1994|154|8.9|en|Crime;Thriller|John Travolta;Uma Thurman;Samuel L. Jackson|hitman;nonlinear;dialogue
Reservoir Dogs|1992|99|8.3|en|Crime;Thriller|Harvey Keitel;Tim Roth;Steve Buscemi|heist gone wrong;betrayal
Fight Club|1999|139|8.8|en|Drama;Thriller|Brad Pitt;Edward Norton;Helena Bonham Carter|identity;twist;anarchy
Se7en|1995|127|8.6|en|Crime;Mystery;Thriller|Brad Pitt;Morgan Freeman;Kevin Spacey|serial killer;detective;sins
Zodiac|2007|157|7.7|en|Crime;Mystery;Thriller|Jake Gyllenhaal;Mark Ruffalo;Robert Downey Jr.|serial killer;obsession;true story
Gone Girl|2014|149|8.1|en|Mystery;Thriller;Drama|Ben Affleck;Rosamund Pike|marriage;disappearance;twist
The Social Network|2010|120|7.8|en|Drama|Jesse Eisenberg;Andrew Garfield|startup;friendship;lawsuit
Prisoners|2013|153|8.1|en|Crime;Mystery;Thriller|Hugh Jackman;Jake Gyllenhaal|kidnapping;detective;father
Sicario|2015|121|7.6|en|Crime;Thriller;Action|Emily Blunt;Benicio del Toro;Josh Brolin|cartel;border;morality
No Country for Old Men|2007|122|8.2|en|Crime;Thriller;Western|Tommy Lee Jones;Javier Bardem;Josh Brolin|hitman;money;fate
Fargo|1996|98|8.1|en|Crime;Thriller;Comedy|Frances McDormand;William H. Macy|kidnapping;snow;police
The Departed|2006|151|8.5|en|Crime;Thriller;Drama|Leonardo DiCaprio;Matt Damon;Jack Nicholson|mole;police;mob
Heat|1995|170|8.3|en|Crime;Action;Thriller|Al Pacino;Robert De Niro;Val Kilmer|heist;detective;los angeles
The Usual Suspects|1995|106|8.5|en|Crime;Mystery;Thriller|Kevin Spacey;Gabriel Byrne|twist;interrogation;legend
L.A. Confidential|1997|138|8.2|en|Crime;Mystery;Drama|Russell Crowe;Kevin Spacey;Guy Pearce|corruption;police;noir
Knives Out|2019|130|7.9|en|Mystery;Comedy;Crime|Daniel Craig;Ana de Armas;Chris Evans|whodunit;family;inheritance
Glass Onion|2022|139|7.1|en|Mystery;Comedy;Crime|Daniel Craig;Janelle Monae;Edward Norton|whodunit;island;billionaire
Shutter Island|2010|138|8.2|en|Mystery;Thriller|Leonardo DiCaprio;Mark Ruffalo|asylum;twist;identity
The Silence of the Lambs|1991|118|8.6|en|Crime;Thriller;Horror|Jodie Foster;Anthony Hopkins|serial killer;fbi;psychiatrist
Catch Me If You Can|2002|141|8.1|en|Crime;Drama;Comedy|Leonardo DiCaprio;Tom Hanks|con artist;chase;true story
Ocean's Eleven|2001|116|7.8|en|Crime;Thriller;Comedy|George Clooney;Brad Pitt;Matt Damon|heist;casino;crew
Baby Driver|2017|113|7.5|en|Action;Crime;Music|Ansel Elgort;Lily James;Kevin Spacey|getaway driver;music;heist
Drive|2011|100|7.8|en|Crime;Drama;Thriller|Ryan Gosling;Carey Mulligan|driver;neon;violence
Nightcrawler|2014|117|7.8|en|Crime;Thriller;Drama|Jake Gyllenhaal;Rene Russo|journalism;ambition;night
Taxi Driver|1976|114|8.2|en|Crime;Drama|Robert De Niro;Jodie Foster|loneliness;new york;vigilante
Snatch|2000|104|8.2|en|Crime;Comedy|Jason Statham;Brad Pitt;Benicio del Toro|diamond;boxing;london
Lock, Stock and Two Smoking Barrels|1998|107|8.1|en|Crime;Comedy|Jason Statham;Jason Flemyng|card game;debt;london
The Grand Budapest Hotel|2014|99|8.1|en|Comedy;Adventure;Crime|Ralph Fiennes;Tony Revolori|hotel;concierge;painting
Parasite|2019|132|8.5|ko|Thriller;Drama;Comedy|Song Kang-ho;Choi Woo-shik;Park So-dam|class;con;family|Gisaengchung
Oldboy|2003|120|8.4|ko|Thriller;Mystery;Action|Choi Min-sik;Yoo Ji-tae|revenge;imprisonment;twist|Oldeuboi
Memories of Murder|2003|132|8.1|ko|Crime;Mystery;Thriller|Song Kang-ho;Kim Sang-kyung|serial killer;detective;countryside|Salinui chueok
Train to Busan|2016|118|7.6|ko|Horror;Action;Thriller|Gong Yoo;Ma Dong-seok|zombie;train;father|Busanhaeng
The Handmaiden|2016|145|8.1|ko|Thriller;Romance;Drama|Kim Min-hee;Kim Tae-ri;Ha Jung-woo|con;heiress;twist|Agassi
Decision to Leave|2022|139|7.3|ko|Mystery;Romance;Thriller|Tang Wei;Park Hae-il|detective;obsession;mountain|Heojil kyolshim
The Host|2006|120|7.1|ko|Horror;Sci-Fi;Comedy|Song Kang-ho;Bae Doona|monster;river;family|Gwoemul
Spirited Away|2001|125|8.6|ja|Animation;Fantasy;Family|Rumi Hiiragi;Miyu Irino|spirits;bathhouse;courage|Sen to Chihiro no kamikakushi
My Neighbor Totoro|1988|86|8.1|ja|Animation;Family;Fantasy|Noriko Hidaka;Chika Sakamoto|forest spirit;sisters;countryside|Tonari no Totoro
Princess Mononoke|1997|134|8.4|ja|Animation;Fantasy;Adventure|Yoji Matsuda;Yuriko Ishida|forest;gods;war|Mononoke-hime
Howl's Moving Castle|2004|119|8.2|ja|Animation;Fantasy;Romance|Chieko Baisho;Takuya Kimura|wizard;curse;castle|Hauru no ugoku shiro
Kiki's Delivery Service|1989|103|7.8|ja|Animation;Family;Fantasy|Minami Takayama;Rei Sakuma|witch;independence;bakery|Majo no takkyubin
Ponyo|2008|101|7.6|ja|Animation;Family;Fantasy|Yuria Nara;Hiroki Doi|ocean;friendship;goldfish|Gake no ue no Ponyo
The Wind Rises|2013|126|7.8|ja|Animation;Drama;History|Hideaki Anno;Miori Takimoto|aviation;dream;engineer|Kaze tachinu
Castle in the Sky|1986|125|8.0|ja|Animation;Adventure;Fantasy|Mayumi Tanaka;Keiko Yokozawa|floating city;pirates;crystal|Tenku no shiro Rapyuta
Grave of the Fireflies|1988|89|8.5|ja|Animation;War;Drama|Tsutomu Tatsumi;Ayano Shiraishi|siblings;war;survival|Hotaru no haka
Your Name|2016|106|8.4|ja|Animation;Romance;Fantasy|Ryunosuke Kamiki;Mone Kamishiraishi|body swap;comet;time|Kimi no na wa
Weathering with You|2019|112|7.5|ja|Animation;Romance;Fantasy|Kotaro Daigo;Nana Mori|weather;tokyo;runaway|Tenki no ko
Suzume|2022|122|7.7|ja|Animation;Adventure;Fantasy|Nanoka Hara;Hokuto Matsumura|doors;earthquake;road trip|Suzume no tojimari
A Silent Voice|2016|130|8.1|ja|Animation;Drama;Romance|Miyu Irino;Saori Hayami|bullying;deafness;redemption|Koe no katachi
Akira|1988|124|8.0|ja|Animation;Sci-Fi;Action|Mitsuo Iwata;Nozomu Sasaki|neo tokyo;psychic;biker gang
Ghost in the Shell|1995|83|7.9|ja|Animation;Sci-Fi;Action|Atsuko Tanaka;Akio Otsuka|cyborg;identity;hacker|Kokaku kidotai
Perfect Blue|1997|81|8.0|ja|Animation;Thriller;Mystery|Junko Iwao;Rica Matsumoto|pop idol;stalker;reality
Paprika|2006|90|7.6|ja|Animation;Sci-Fi;Mystery|Megumi Hayashibara;Toru Furuya|dream;therapy;device
Seven Samurai|1954|207|8.6|ja|Action;Drama;History|Toshiro Mifune;Takashi Shimura|samurai;village;bandits|Shichinin no samurai
Rashomon|1950|88|8.2|ja|Crime;Mystery;Drama|Toshiro Mifune;Machiko Kyo|perspective;trial;truth
Shoplifters|2018|121|7.9|ja|Drama;Crime|Lily Franky;Sakura Ando|found family;poverty;tokyo|Manbiki kazoku
Drive My Car|2021|179|7.6|ja|Drama|Hidetoshi Nishijima;Toko Miura|grief;theatre;road|Doraibu mai ka
Godzilla Minus One|2023|125|7.7|ja|Sci-Fi;Action;Drama|Ryunosuke Kamiki;Minami Hamabe|kaiju;postwar;redemption|Gojira -1.0
Toy Story|1995|81|8.3|en|Animation;Comedy;Family|Tom Hanks;Tim Allen|toys;friendship;rivalry
Toy Story 3|2010|103|8.3|en|Animation;Comedy;Family|Tom Hanks;Tim Allen;Joan Cusack|toys;growing up;daycare
Finding Nemo|2003|100|8.2|en|Animation;Family;Adventure|Albert Brooks;Ellen DeGeneres|ocean;father;fish
WALL-E|2008|98|8.4|en|Animation;Sci-Fi;Family|Ben Burtt;Elissa Knight|robot;love;earth
Up|2009|96|8.3|en|Animation;Adventure;Family|Ed Asner;Jordan Nagai|balloons;adventure;grief
Inside Out|2015|95|8.1|en|Animation;Family;Comedy|Amy Poehler;Phyllis Smith|emotions;memory;growing up
Coco|2017|105|8.4|en|Animation;Family;Music|Anthony Gonzalez;Gael Garcia Bernal|day of the dead;music;family
Ratatouille|2007|111|8.1|en|Animation;Comedy;Family|Patton Oswalt;Lou Romano|rat;chef;paris;food
Monsters, Inc.|2001|92|8.1|en|Animation;Comedy;Family|Billy Crystal;John Goodman|monsters;child;friendship
The Incredibles|2004|115|8.0|en|Animation;Action;Family|Craig T. Nelson;Holly Hunter|superhero;family;retirement
Soul|2020|100|8.0|en|Animation;Comedy;Fantasy|Jamie Foxx;Tina Fey|jazz;afterlife;purpose
Turning Red|2022|100|7.0|en|Animation;Comedy;Family|Rosalie Chiang;Sandra Oh|red panda;puberty;toronto
Luca|2021|95|7.4|en|Animation;Comedy;Family|Jacob Tremblay;Jack Dylan Grazer|sea monster;summer;friendship
Zootopia|2016|108|8.0|en|Animation;Comedy;Mystery|Ginnifer Goodwin;Jason Bateman|bunny cop;fox;conspiracy
Frozen|2013|102|7.4|en|Animation;Family;Music|Kristen Bell;Idina Menzel|sisters;ice;curse
Moana|2016|107|7.6|en|Animation;Adventure;Family|Auli'i Cravalho;Dwayne Johnson|ocean;voyage;demigod
Encanto|2021|102|7.2|en|Animation;Family;Music|Stephanie Beatriz;Maria Cecilia Botero|magic;family;house
Tangled|2010|100|7.7|en|Animation;Family;Romance|Mandy Moore;Zachary Levi|tower;hair;lanterns
The Lion King|1994|88|8.5|en|Animation;Family;Drama|Matthew Broderick;Jeremy Irons;James Earl Jones|savanna;father;destiny
Aladdin|1992|90|8.0|en|Animation;Family;Romance|Scott Weinger;Robin Williams|genie;lamp;wishes
Beauty and the Beast|1991|84|8.0|en|Animation;Family;Romance|Paige O'Hara;Robby Benson|curse;castle;love
Shrek|2001|90|7.9|en|Animation;Comedy;Family|Mike Myers;Eddie Murphy;Cameron Diaz|ogre;fairy tale;donkey
Shrek 2|2004|93|7.3|en|Animation;Comedy;Family|Mike Myers;Eddie Murphy;Cameron Diaz|ogre;in-laws;fairy tale
How to Train Your Dragon|2010|98|8.1|en|Animation;Adventure;Family|Jay Baruchel;Gerard Butler|dragon;vikings;friendship
Kung Fu Panda|2008|92|7.6|en|Animation;Comedy;Action|Jack Black;Dustin Hoffman;Angelina Jolie|panda;martial arts;destiny
Puss in Boots: The Last Wish|2022|102|7.8|en|Animation;Comedy;Adventure|Antonio Banderas;Salma Hayek|wishing star;mortality;fairy tale
The Lego Movie|2014|100|7.7|en|Animation;Comedy;Adventure|Chris Pratt;Elizabeth Banks;Will Arnett|lego;chosen one;creativity
The Iron Giant|1999|86|8.1|en|Animation;Sci-Fi;Family|Eli Marienthal;Vin Diesel|robot;cold war;friendship
Coraline|2009|100|7.7|en|Animation;Fantasy;Horror|Dakota Fanning;Teri Hatcher|other mother;buttons;door
Fantastic Mr. Fox|2009|87|7.9|en|Animation;Comedy;Adventure|George Clooney;Meryl Streep|fox;farmers;heist
Wallace & Gromit: The Curse of the Were-Rabbit|2005|85|7.4|en|Animation;Comedy;Family|Peter Sallis;Helena Bonham Carter|claymation;vegetables;inventor
Paddington 2|2017|103|7.8|en|Family;Comedy;Adventure|Ben Whishaw;Hugh Grant;Hugh Bonneville|bear;prison;kindness
Paddington|2014|95|7.3|en|Family;Comedy;Adventure|Ben Whishaw;Hugh Bonneville;Nicole Kidman|bear;london;family
Klaus|2019|96|8.2|en|Animation;Family;Comedy|Jason Schwartzman;J.K. Simmons|christmas;postman;toys
The Mitchells vs. the Machines|2021|113|7.6|en|Animation;Comedy;Sci-Fi|Abbi Jacobson;Danny McBride|road trip;robot apocalypse;family
Wolfwalkers|2020|103|8.0|en|Animation;Fantasy;Family|Honor Kneafsey;Eva Whittaker|wolves;ireland;friendship
Song of the Sea|2014|93|8.0|en|Animation;Fantasy;Family|David Rawle;Brendan Gleeson|selkie;siblings;folklore
The Nightmare Before Christmas|1993|76|7.9|en|Animation;Family;Fantasy|Danny Elfman;Chris Sarandon|halloween;christmas;skeleton
Home Alone|1990|103|7.7|en|Comedy;Family|Macaulay Culkin;Joe Pesci|christmas;burglars;traps;holiday
Elf|2003|97|7.0|en|Comedy;Family;Fantasy|Will Ferrell;James Caan;Zooey Deschanel|christmas;north pole;new york;holiday
The Princess Bride|1987|98|8.0|en|Adventure;Comedy;Romance|Cary Elwes;Robin Wright;Mandy Patinkin|true love;sword;storybook
Groundhog Day|1993|101|8.0|en|Comedy;Romance;Fantasy|Bill Murray;Andie MacDowell|time loop;weatherman;small town
Ferris Bueller's Day Off|1986|103|7.8|en|Comedy|Matthew Broderick;Mia Sara;Alan Ruck|skipping school;chicago;friendship
The Big Lebowski|1998|117|8.1|en|Comedy;Crime|Jeff Bridges;John Goodman;Julianne Moore|bowling;rug;kidnapping
Superbad|2007|113|7.6|en|Comedy|Jonah Hill;Michael Cera;Christopher Mintz-Plasse|high school;party;friendship
The Hangover|2009|100|7.7|en|Comedy|Bradley Cooper;Ed Helms;Zach Galifianakis|bachelor party;las vegas;memory
Bridesmaids|2011|125|6.8|en|Comedy;Romance|Kristen Wiig;Maya Rudolph;Melissa McCarthy|wedding;friendship;rivalry
Step Brothers|2008|98|6.9|en|Comedy|Will Ferrell;John C. Reilly|stepbrothers;bunk beds;family
Anchorman|2004|94|7.2|en|Comedy|Will Ferrell;Christina Applegate;Steve Carell|news anchor;san diego;rivalry
Shaun of the Dead|2004|99|7.9|en|Comedy;Horror|Simon Pegg;Nick Frost|zombie;pub;friendship
Hot Fuzz|2007|121|7.8|en|Comedy;Action;Mystery|Simon Pegg;Nick Frost|police;village;conspiracy
The World's End|2013|109|7.0|en|Comedy;Sci-Fi;Action|Simon Pegg;Nick Frost|pub crawl;robots;friendship
Monty Python and the Holy Grail|1975|91|8.2|en|Comedy;Adventure;Fantasy|Graham Chapman;John Cleese|king arthur;quest;absurd
Airplane!|1980|88|7.7|en|Comedy|Robert Hays;Julie Hagerty;Leslie Nielsen|parody;flight;disaster
Office Space|1999|89|7.6|en|Comedy|Ron Livingston;Jennifer Aniston|office;stapler;rebellion
Mean Girls|2004|97|7.1|en|Comedy|Lindsay Lohan;Rachel McAdams;Tina Fey|high school;cliques;satire
Legally Blonde|2001|96|6.4|en|Comedy;Romance|Reese Witherspoon;Luke Wilson|law school;harvard;underdog
Clueless|1995|97|6.9|en|Comedy;Romance|Alicia Silverstone;Paul Rudd|beverly hills;makeover;high school
The Truman Show|1998|103|8.2|en|Comedy;Drama;Sci-Fi|Jim Carrey;Laura Linney;Ed Harris|reality show;simulation;freedom
Jojo Rabbit|2019|108|7.9|en|Comedy;War;Drama|Roman Griffin Davis;Taika Waititi;Scarlett Johansson|satire;world war ii;childhood
What We Do in the Shadows|2014|86|7.7|en|Comedy;Horror|Jemaine Clement;Taika Waititi|vampires;mockumentary;flatmates
Hunt for the Wilderpeople|2016|101|7.8|en|Comedy;Adventure;Drama|Sam Neill;Julian Dennison|bush;foster kid;manhunt
Little Miss Sunshine|2006|101|7.8|en|Comedy;Drama|Abigail Breslin;Steve Carell;Toni Collette|road trip;pageant;family
Juno|2007|96|7.4|en|Comedy;Drama;Romance|Elliot Page;Michael Cera|pregnancy;teen;adoption
Lady Bird|2017|94|7.4|en|Comedy;Drama|Saoirse Ronan;Laurie Metcalf|mother daughter;sacramento;coming of age
Barbie|2023|114|6.8|en|Comedy;Fantasy;Adventure|Margot Robbie;Ryan Gosling;America Ferrera|dreamhouse;identity;satire
Free Guy|2021|115|7.1|en|Comedy;Action;Sci-Fi|Ryan Reynolds;Jodie Comer|video game;npc;simulation
Deadpool|2016|108|8.0|en|Action;Comedy|Ryan Reynolds;Morena Baccarin|antihero;fourth wall;revenge
21 Jump Street|2012|109|7.2|en|Comedy;Action;Crime|Jonah Hill;Channing Tatum|undercover;high school;police
Crazy Rich Asians|2018|120|6.9|en|Comedy;Romance|Constance Wu;Henry Golding;Michelle Yeoh|singapore;wedding;family
La La Land|2016|128|8.0|en|Romance;Music;Drama|Ryan Gosling;Emma Stone|jazz;los angeles;dreams
Before Sunrise|1995|101|8.1|en|Romance;Drama|Ethan Hawke;Julie Delpy|vienna;train;conversation
Before Sunset|2004|80|8.1|en|Romance;Drama|Ethan Hawke;Julie Delpy|paris;reunion;conversation
Notting Hill|1999|124|7.2|en|Romance;Comedy|Hugh Grant;Julia Roberts|bookshop;movie star;london
Love Actually|2003|135|7.6|en|Romance;Comedy|Hugh Grant;Emma Thompson;Liam Neeson|christmas;ensemble;london;holiday
About Time|2013|123|7.8|en|Romance;Comedy;Fantasy|Domhnall Gleeson;Rachel McAdams;Bill Nighy|time travel;family;love
The Notebook|2004|123|7.8|en|Romance;Drama|Ryan Gosling;Rachel McAdams|first love;memory;summer
Pride & Prejudice|2005|129|7.8|en|Romance;Drama|Keira Knightley;Matthew Macfadyen|regency;sisters;marriage
When Harry Met Sally...|1989|95|7.7|en|Romance;Comedy|Billy Crystal;Meg Ryan|friendship;new york;love
10 Things I Hate About You|1999|97|7.3|en|Romance;Comedy|Heath Ledger;Julia Stiles|high school;bet;shakespeare
Titanic|1997|194|7.9|en|Romance;Drama;History|Leonardo DiCaprio;Kate Winslet|ship;iceberg;class
Call Me by Your Name|2017|132|7.8|en|Romance;Drama|Timothee Chalamet;Armie Hammer|summer;italy;first love
Past Lives|2023|105|7.8|en|Romance;Drama|Greta Lee;Teo Yoo;John Magaro|childhood;fate;new york
Portrait of a Lady on Fire|2019|122|8.1|fr|Romance;Drama;History|Noemie Merlant;Adele Haenel|painter;island;forbidden love|Portrait de la jeune fille en feu
Amelie|2001|122|8.3|fr|Romance;Comedy|Audrey Tautou;Mathieu Kassovitz|paris;whimsy;kindness|Le fabuleux destin d'Amelie Poulain
The Intouchables|2011|112|8.5|fr|Comedy;Drama|Francois Cluzet;Omar Sy|friendship;caregiver;true story|Intouchables
Leon: The Professional|1994|110|8.5|fr|Action;Crime;Drama|Jean Reno;Natalie Portman;Gary Oldman|hitman;orphan;new york|Leon
La Haine|1995|98|8.1|fr|Crime;Drama|Vincent Cassel;Hubert Kounde|banlieue;riots;24 hours
Anatomy of a Fall|2023|151|7.7|fr|Crime;Drama;Mystery|Sandra Huller;Swann Arlaud|trial;marriage;mountain chalet|Anatomie d'une chute
Pan's Labyrinth|2006|118|8.2|es|Fantasy;Drama;War|Ivana Baquero;Sergi Lopez|faun;civil war;fairy tale|El laberinto del fauno
The Orphanage|2007|105|7.4|es|Horror;Mystery;Thriller|Belen Rueda;Fernando Cayo|ghosts;orphanage;mother|El orfanato
Y Tu Mama Tambien|2001|106|7.6|es|Drama;Romance;Comedy|Gael Garcia Bernal;Diego Luna|road trip;friendship;coming of age
Roma|2018|135|7.7|es|Drama|Yalitza Aparicio;Marina de Tavira|housekeeper;mexico city;family
The Secret in Their Eyes|2009|129|8.2|es|Crime;Mystery;Romance|Ricardo Darin;Soledad Villamil|cold case;justice;love|El secreto de sus ojos
Wild Tales|2014|122|8.1|es|Comedy;Thriller;Drama|Ricardo Darin;Oscar Martinez|revenge;anthology;dark comedy|Relatos salvajes
Run Lola Run|1998|81|7.6|de|Thriller;Crime|Franka Potente;Moritz Bleibtreu|time loop;berlin;race against time|Lola rennt
The Lives of Others|2006|137|8.4|de|Drama;Thriller|Ulrich Muhe;Sebastian Koch|surveillance;east germany;artist|Das Leben der Anderen
Good Bye Lenin!|2003|121|7.7|de|Comedy;Drama|Daniel Bruhl;Katrin Sass|berlin wall;mother;deception
Das Boot|1981|149|8.3|de|War;Drama;Thriller|Jurgen Prochnow;Herbert Gronemeyer|submarine;world war ii;claustrophobia
All Quiet on the Western Front|2022|148|7.8|de|War;Drama;History|Felix Kammerer;Albrecht Schuch|world war i;trenches;youth|Im Westen nichts Neues
Life Is Beautiful|1997|116|8.6|it|Comedy;Drama;War|Roberto Benigni;Nicoletta Braschi|father;holocaust;imagination|La vita e bella
Cinema Paradiso|1988|155|8.5|it|Drama;Romance|Philippe Noiret;Salvatore Cascio|cinema;childhood;nostalgia|Nuovo Cinema Paradiso
The Good, the Bad and the Ugly|1966|178|8.8|it|Western;Adventure|Clint Eastwood;Eli Wallach;Lee Van Cleef|gold;duel;civil war|Il buono, il brutto, il cattivo
Once Upon a Time in the West|1968|166|8.5|it|Western|Henry Fonda;Charles Bronson;Claudia Cardinale|railroad;revenge;harmonica|C'era una volta il West
Django Unchained|2012|165|8.5|en|Western;Drama;Action|Jamie Foxx;Christoph Waltz;Leonardo DiCaprio|bounty hunter;slavery;revenge
True Grit|2010|110|7.6|en|Western;Drama;Adventure|Jeff Bridges;Hailee Steinfeld;Matt Damon|marshal;revenge;frontier
Unforgiven|1992|130|8.2|en|Western;Drama|Clint Eastwood;Gene Hackman;Morgan Freeman|gunslinger;bounty;retirement
The Hateful Eight|2015|168|7.8|en|Western;Mystery;Crime|Samuel L. Jackson;Kurt Russell;Jennifer Jason Leigh|blizzard;bounty;cabin
Butch Cassidy and the Sundance Kid|1969|110|8.0|en|Western;Crime;Drama|Paul Newman;Robert Redford|outlaws;friendship;bolivia
3:10 to Yuma|2007|122|7.7|en|Western;Action;Drama|Russell Crowe;Christian Bale|outlaw;train;rancher
The Power of the Dog|2021|126|6.8|en|Western;Drama|Benedict Cumberbatch;Kirsten Dunst|ranch;cruelty;secret
Saving Private Ryan|1998|169|8.6|en|War;Drama|Tom Hanks;Matt Damon|d-day;rescue;brotherhood
Schindler's List|1993|195|9.0|en|History;War;Drama|Liam Neeson;Ben Kingsley;Ralph Fiennes|holocaust;rescue;true story
1917|2019|119|8.2|en|War;Drama;Thriller|George MacKay;Dean-Charles Chapman|world war i;one shot;message
Hacksaw Ridge|2016|139|8.1|en|War;Drama;History|Andrew Garfield;Vince Vaughn|medic;faith;okinawa
Apocalypse Now|1979|147|8.4|en|War;Drama|Martin Sheen;Marlon Brando|vietnam;river;madness
Full Metal Jacket|1987|116|8.3|en|War;Drama|Matthew Modine;R. Lee Ermey|marines;boot camp;vietnam
Inglourious Basterds|2009|153|8.4|en|War;Drama;Action|Brad Pitt;Christoph Waltz;Melanie Laurent|world war ii;revenge;cinema
Black Hawk Down|2001|144|7.7|en|War;Action;History|Josh Hartnett;Ewan McGregor|mogadishu;rescue;soldiers
Fury|2014|134|7.6|en|War;Action;Drama|Brad Pitt;Logan Lerman|tank;world war ii;crew
Lawrence of Arabia|1962|218|8.3|en|Adventure;History;War|Peter O'Toole;Omar Sharif|desert;revolt;legend
The Lord of the Rings: The Fellowship of the Ring|2001|178|8.9|en|Fantasy;Adventure|Elijah Wood;Ian McKellen;Viggo Mortensen|ring;quest;friendship
The Lord of the Rings: The Two Towers|2002|179|8.8|en|Fantasy;Adventure;War|Elijah Wood;Ian McKellen;Viggo Mortensen|ring;battle;helms deep
The Lord of the Rings: The Return of the King|2003|201|9.0|en|Fantasy;Adventure;War|Elijah Wood;Ian McKellen;Viggo Mortensen|ring;king;final battle
The Hobbit: An Unexpected Journey|2012|169|7.8|en|Fantasy;Adventure|Martin Freeman;Ian McKellen|dwarves;dragon;quest
Harry Potter and the Sorcerer's Stone|2001|152|7.6|en|Fantasy;Family;Adventure|Daniel Radcliffe;Emma Watson;Rupert Grint|wizard;school;friendship
Harry Potter and the Prisoner of Azkaban|2004|142|7.9|en|Fantasy;Family;Mystery|Daniel Radcliffe;Emma Watson;Gary Oldman|wizard;time;godfather
Harry Potter and the Deathly Hallows: Part 2|2011|130|8.1|en|Fantasy;Adventure;Drama|Daniel Radcliffe;Emma Watson;Ralph Fiennes|wizard;final battle;sacrifice
The Chronicles of Narnia: The Lion, the Witch and the Wardrobe|2005|143|6.9|en|Fantasy;Family;Adventure|Georgie Henley;Tilda Swinton|wardrobe;lion;winter
Stardust|2007|127|7.6|en|Fantasy;Romance;Adventure|Charlie Cox;Claire Danes;Michelle Pfeiffer|fallen star;witches;quest
The Shape of Water|2017|123|7.3|en|Fantasy;Romance;Drama|Sally Hawkins;Michael Shannon|creature;cold war;love
Big Fish|2003|125|8.0|en|Fantasy;Drama;Adventure|Ewan McGregor;Albert Finney;Billy Crudup|tall tales;father;legend
Edward Scissorhands|1990|105|7.9|en|Fantasy;Romance;Drama|Johnny Depp;Winona Ryder|outsider;suburbia;scissors
Labyrinth|1986|101|7.3|en|Fantasy;Adventure;Music|David Bowie;Jennifer Connelly|goblin king;maze;baby brother
The NeverEnding Story|1984|102|7.3|en|Fantasy;Adventure;Family|Barret Oliver;Noah Hathaway|book;luckdragon;nothing
The Green Knight|2021|130|6.6|en|Fantasy;Adventure;Drama|Dev Patel;Alicia Vikander|arthurian;quest;honor
Get Out|2017|104|7.8|en|Horror;Mystery;Thriller|Daniel Kaluuya;Allison Williams|hypnosis;racism;family visit
Us|2019|116|6.8|en|Horror;Thriller;Mystery|Lupita Nyong'o;Winston Duke|doppelganger;beach;twist
Nope|2022|130|6.8|en|Horror;Sci-Fi;Mystery|Daniel Kaluuya;Keke Palmer|ufo;ranch;spectacle
Hereditary|2018|127|7.3|en|Horror;Mystery;Drama|Toni Collette;Alex Wolff|grief;cult;family
Midsommar|2019|148|7.1|en|Horror;Drama;Mystery|Florence Pugh;Jack Reynor|cult;sweden;breakup
The Witch|2015|92|6.9|en|Horror;Mystery;Drama|Anya Taylor-Joy;Ralph Ineson|puritan;forest;goat
A Quiet Place|2018|90|7.5|en|Horror;Sci-Fi;Thriller|Emily Blunt;John Krasinski|silence;creatures;family
The Shining|1980|146|8.4|en|Horror;Mystery|Jack Nicholson;Shelley Duvall|hotel;madness;winter
The Exorcist|1973|122|8.1|en|Horror|Ellen Burstyn;Max von Sydow;Linda Blair|possession;priest;demon
Psycho|1960|109|8.5|en|Horror;Mystery;Thriller|Anthony Perkins;Janet Leigh|motel;mother;twist
Rear Window|1954|112|8.5|en|Mystery;Thriller|James Stewart;Grace Kelly|voyeur;murder;apartment
Vertigo|1958|128|8.2|en|Mystery;Romance;Thriller|James Stewart;Kim Novak|obsession;detective;identity
The Thing|1982|109|8.2|en|Horror;Sci-Fi;Mystery|Kurt Russell;Wilford Brimley|antarctica;paranoia;shapeshifter
Jaws|1975|124|8.1|en|Thriller;Adventure;Horror|Roy Scheider;Robert Shaw;Richard Dreyfuss|shark;beach town;hunt
It Follows|2014|100|6.8|en|Horror;Mystery|Maika Monroe;Keir Gilchrist|curse;stalker;suburbia
The Babadook|2014|94|6.8|en|Horror;Drama|Essie Davis;Noah Wiseman|grief;storybook;mother
The Conjuring|2013|112|7.5|en|Horror;Mystery|Vera Farmiga;Patrick Wilson|haunting;farmhouse;paranormal
Scream|1996|111|7.4|en|Horror;Mystery|Neve Campbell;Courteney Cox;David Arquette|slasher;meta;high school
Talk to Me|2022|95|7.1|en|Horror;Thriller|Sophie Wilde;Alexandra Jensen|seance;hand;party
Barbarian|2022|102|7.0|en|Horror;Thriller;Mystery|Georgina Campbell;Bill Skarsgard;Justin Long|airbnb;basement;twist
Smile|2022|115|6.5|en|Horror;Mystery|Sosie Bacon;Kyle Gallner|curse;therapist;trauma
The Others|2001|101|7.6|en|Horror;Mystery;Drama|Nicole Kidman;Fionnula Flanagan|ghosts;mansion;twist
The Sixth Sense|1999|107|8.2|en|Mystery;Drama;Thriller|Bruce Willis;Haley Joel Osment|ghosts;child psychologist;twist
Signs|2002|106|6.8|en|Mystery;Sci-Fi;Thriller|Mel Gibson;Joaquin Phoenix|crop circles;faith;aliens
Cloverfield|2008|85|7.0|en|Sci-Fi;Horror;Action|Michael Stahl-David;Lizzy Caplan|found footage;monster;new york
The Sound of Music|1965|172|8.1|en|Music;Family;Romance|Julie Andrews;Christopher Plummer|governess;austria;singing
Mamma Mia!|2008|108|6.5|en|Music;Comedy;Romance|Meryl Streep;Amanda Seyfried;Pierce Brosnan|abba;wedding;greek island
Whiplash|2014|106|8.5|en|Music;Drama|Miles Teller;J.K. Simmons|drummer;mentor;obsession
Bohemian Rhapsody|2018|134|7.9|en|Music;Drama;History|Rami Malek;Lucy Boynton|queen;freddie mercury;biography
A Star Is Born|2018|136|7.6|en|Music;Romance;Drama|Lady Gaga;Bradley Cooper|singer;fame;addiction
School of Rock|2003|109|7.2|en|Comedy;Music;Family|Jack Black;Joan Cusack|substitute teacher;rock band;kids
Sing Street|2016|106|7.9|en|Music;Romance;Comedy|Ferdia Walsh-Peelo;Lucy Boynton|dublin;band;1980s
Amadeus|1984|160|8.4|en|Music;Drama;History|F. Murray Abraham;Tom Hulce|mozart;rivalry;genius
Singin' in the Rain|1952|103|8.3|en|Music;Comedy;Romance|Gene Kelly;Debbie Reynolds|hollywood;talkies;dance
Top Gun|1986|110|6.9|en|Action;Drama;Romance|Tom Cruise;Kelly McGillis;Val Kilmer|fighter pilot;rivalry;navy
Forrest Gump|1994|142|8.8|en|Drama;Romance;Comedy|Tom Hanks;Robin Wright;Gary Sinise|life story;history;love
Good Will Hunting|1997|126|8.3|en|Drama;Romance|Matt Damon;Robin Williams;Ben Affleck|genius;therapy;boston
Dead Poets Society|1989|128|8.1|en|Drama|Robin Williams;Ethan Hawke|teacher;poetry;boarding school
The Green Mile|1999|189|8.6|en|Drama;Fantasy;Crime|Tom Hanks;Michael Clarke Duncan|death row;miracle;guard
One Flew Over the Cuckoo's Nest|1975|133|8.7|en|Drama|Jack Nicholson;Louise Fletcher|asylum;rebellion;freedom
12 Angry Men|1957|96|9.0|en|Drama;Crime|Henry Fonda;Lee J. Cobb|jury;doubt;justice
Rocky|1976|120|8.1|en|Drama;Action|Sylvester Stallone;Talia Shire|boxing;underdog;philadelphia
Creed|2015|133|7.6|en|Drama;Action|Michael B. Jordan;Sylvester Stallone|boxing;legacy;mentor
Ford v Ferrari|2019|152|8.1|en|Drama;Action;History|Matt Damon;Christian Bale|racing;le mans;true story
Rush|2013|123|8.1|en|Drama;Action;History|Chris Hemsworth;Daniel Bruhl|formula one;rivalry;true story
Moneyball|2011|133|7.6|en|Drama;History|Brad Pitt;Jonah Hill|baseball;statistics;underdog
The Wolf of Wall Street|2013|180|8.2|en|Comedy;Crime;Drama|Leonardo DiCaprio;Jonah Hill;Margot Robbie|stockbroker;excess;fraud
The Big Short|2015|130|7.8|en|Comedy;Drama;History|Christian Bale;Steve Carell;Ryan Gosling|financial crisis;housing;bet
Spotlight|2015|129|8.1|en|Drama;Crime;History|Mark Ruffalo;Michael Keaton;Rachel McAdams|journalism;investigation;boston
There Will Be Blood|2007|158|8.2|en|Drama|Daniel Day-Lewis;Paul Dano|oil;greed;preacher
The Revenant|2015|156|8.0|en|Adventure;Drama;Western|Leonardo DiCaprio;Tom Hardy|survival;bear;revenge
Into the Wild|2007|148|8.1|en|Adventure;Drama|Emile Hirsch;Vince Vaughn|alaska;freedom;true story
127 Hours|2010|94|7.5|en|Adventure;Drama;Thriller|James Franco;Amber Tamblyn|canyon;trapped;survival
Cast Away|2000|143|7.8|en|Adventure;Drama|Tom Hanks;Helen Hunt|island;survival;volleyball
Life of Pi|2012|127|7.9|en|Adventure;Drama;Fantasy|Suraj Sharma;Irrfan Khan|tiger;ocean;faith
The Secret Life of Walter Mitty|2013|114|7.3|en|Adventure;Comedy;Drama|Ben Stiller;Kristen Wiig|daydream;iceland;photo
Slumdog Millionaire|2008|120|8.0|en|Drama;Romance|Dev Patel;Freida Pinto|game show;mumbai;destiny
The Lunchbox|2013|104|7.8|hi|Drama;Romance|Irrfan Khan;Nimrat Kaur|letters;mumbai;tiffin
3 Idiots|2009|170|8.4|hi|Comedy;Drama|Aamir Khan;Kareena Kapoor;R. Madhavan|engineering college;friendship;pressure
Dangal|2016|161|8.3|hi|Drama;Action|Aamir Khan;Fatima Sana Shaikh|wrestling;father;daughters
Lagaan|2001|224|8.1|hi|Drama;Music;History|Aamir Khan;Gracy Singh|cricket;colonial;village
Taare Zameen Par|2007|165|8.3|hi|Drama;Family|Darsheel Safary;Aamir Khan|dyslexia;teacher;art
Zindagi Na Milegi Dobara|2011|155|8.2|hi|Comedy;Drama;Adventure|Hrithik Roshan;Farhan Akhtar;Abhay Deol|road trip;spain;friendship
Queen|2013|146|8.1|hi|Comedy;Drama|Kangana Ranaut;Rajkummar Rao|solo honeymoon;paris;independence
Andhadhun|2018|139|8.2|hi|Crime;Thriller;Comedy|Ayushmann Khurrana;Tabu|blind pianist;murder;twist
Gully Boy|2019|154|7.9|hi|Music;Drama|Ranveer Singh;Alia Bhatt|rap;mumbai;dreams
Swades|2004|210|8.2|hi|Drama|Shah Rukh Khan;Gayatri Joshi|nasa;village;homecoming
Dilwale Dulhania Le Jayenge|1995|189|8.0|hi|Romance;Drama;Music|Shah Rukh Khan;Kajol|europe trip;family;love
Kahaani|2012|122|8.1|hi|Mystery;Thriller|Vidya Balan;Parambrata Chatterjee|kolkata;missing husband;twist
Drishyam|2015|163|8.2|hi|Crime;Mystery;Thriller|Ajay Devgn;Tabu|alibi;family;cover-up
RRR|2022|187|7.8|te|Action;Drama;History|N.T. Rama Rao Jr.;Ram Charan|friendship;rebellion;colonial
Baahubali: The Beginning|2015|159|8.0|te|Action;Fantasy;Drama|Prabhas;Rana Daggubati;Anushka Shetty|kingdom;waterfall;destiny
Baahubali 2: The Conclusion|2017|167|8.2|te|Action;Fantasy;Drama|Prabhas;Rana Daggubati;Anushka Shetty|kingdom;betrayal;war
Vikram|2022|175|8.3|ta|Action;Crime;Thriller|Kamal Haasan;Vijay Sethupathi;Fahadh Faasil|black ops;drugs;masked killers
Jai Bhim|2021|164|8.8|ta|Crime;Drama;Mystery|Suriya;Lijomol Jose|lawyer;justice;true story
Super Deluxe|2019|176|8.3|ta|Comedy;Crime;Drama|Vijay Sethupathi;Fahadh Faasil;Samantha Ruth Prabhu|anthology;chennai;dark comedy
Kantara|2022|148|8.2|kn|Action;Drama;Thriller|Rishab Shetty;Sapthami Gowda|forest;folklore;deity
A Separation|2011|123|8.3|fa|Drama;Mystery|Peyman Moaadi;Leila Hatami|divorce;caregiver;morality|Jodaeiye Nader az Simin
Another Round|2020|117|7.7|da|Comedy;Drama|Mads Mikkelsen;Thomas Bo Larsen|teachers;experiment;midlife|Druk
The Hunt|2012|115|8.3|da|Drama;Mystery|Mads Mikkelsen;Thomas Bo Larsen|false accusation;village;teacher|Jagten
Let the Right One In|2008|115|7.8|sv|Horror;Romance;Drama|Kare Hedebrant;Lina Leandersson|vampire;bullying;friendship|Lat den ratte komma in
A Man Called Ove|2015|116|7.7|sv|Comedy;Drama|Rolf Lassgard;Bahar Pars|grumpy neighbor;grief;kindness|En man som heter Ove
The Seventh Seal|1957|96|8.1|sv|Drama;Fantasy|Max von Sydow;Gunnar Bjornstrand|death;chess;plague|Det sjunde inseglet
City of God|2002|130|8.6|pt|Crime;Drama|Alexandre Rodrigues;Leandro Firmino|favela;photography;gangs|Cidade de Deus
Central Station|1998|110|8.0|pt|Drama|Fernanda Montenegro;Vinicius de Oliveira|letters;road trip;orphan|Central do Brasil
Leviathan|2014|140|7.5|ru|Drama;Crime|Aleksey Serebryakov;Elena Lyadova|corruption;land;fate|Leviafan
In the Mood for Love|2000|98|8.1|zh|Romance;Drama|Tony Leung;Maggie Cheung|neighbors;infidelity;hong kong|Fa yeung nin wa
Chungking Express|1994|102|8.0|zh|Romance;Comedy;Drama|Tony Leung;Faye Wong;Takeshi Kaneshiro|hong kong;loneliness;cops|Chung Hing sam lam
Farewell My Concubine|1993|171|8.1|zh|Drama;Romance;History|Leslie Cheung;Zhang Fengyi;Gong Li|peking opera;friendship;revolution|Ba wang bie ji
The Wandering Earth|2019|125|5.9|zh|Sci-Fi;Action;Adventure|Wu Jing;Qu Chuxiao|planet engines;sun;rescue|Liu lang di qiu
Planet Earth II: Islands|2016|60|9.0|en|Documentary|David Attenborough|nature;islands;wildlife
March of the Penguins|2005|80|7.5|fr|Documentary;Family|Morgan Freeman|penguins;antarctica;migration|La marche de l'empereur
Free Solo|2018|100|8.1|en|Documentary;Adventure|Alex Honnold;Tommy Caldwell|climbing;el capitan;fear
My Octopus Teacher|2020|85|8.1|en|Documentary|Craig Foster|octopus;kelp forest;friendship
Jiro Dreams of Sushi|2011|81|7.8|ja|Documentary|Jiro Ono;Yoshikazu Ono|sushi;mastery;tokyo;food
Man on Wire|2008|94|7.7|en|Documentary;History|Philippe Petit|tightrope;twin towers;heist
Won't You Be My Neighbor?|2018|94|8.4|en|Documentary|Fred Rogers|kindness;television;childhood
Searching for Sugar Man|2012|86|8.2|en|Documentary;Music|Sixto Rodriguez|musician;mystery;south africa
Senna|2010|106|8.5|en|Documentary;History|Ayrton Senna;Alain Prost|formula one;legend;rivalry
Apollo 11|2019|93|8.1|en|Documentary;History|Neil Armstrong;Buzz Aldrin|moon landing;archive;space
The Social Dilemma|2020|94|7.6|en|Documentary|Tristan Harris;Jeff Seibert|social media;algorithms;attention
Chef|2014|114|7.3|en|Comedy;Drama|Jon Favreau;Sofia Vergara;John Leguizamo|food truck;father son;road trip;food
Julie & Julia|2009|123|7.0|en|Comedy;Drama;Romance|Meryl Streep;Amy Adams|cooking;blog;paris;food
The Holiday|2006|136|6.9|en|Comedy;Romance|Cameron Diaz;Kate Winslet;Jude Law|house swap;christmas;holiday
Little Women|2019|135|7.8|en|Drama;Romance|Saoirse Ronan;Emma Watson;Florence Pugh|sisters;writer;civil war
Mrs. Doubtfire|1993|125|7.1|en|Comedy;Family;Drama|Robin Williams;Sally Field|divorce;disguise;nanny
Matilda|1996|98|7.0|en|Comedy;Family;Fantasy|Mara Wilson;Danny DeVito|telekinesis;school;books
Charlie and the Chocolate Factory|2005|115|6.7|en|Family;Fantasy;Comedy|Johnny Depp;Freddie Highmore|chocolate;golden ticket;factory
Willy Wonka & the Chocolate Factory|1971|100|7.8|en|Family;Fantasy;Music|Gene Wilder;Peter Ostrum|chocolate;golden ticket;factory
The Goonies|1985|114|7.7|en|Adventure;Comedy;Family|Sean Astin;Josh Brolin|treasure map;pirates;friendship
Stand by Me|1986|89|8.1|en|Adventure;Drama|Wil Wheaton;River Phoenix|friendship;summer;journey
Jumanji: Welcome to the Jungle|2017|119|6.9|en|Adventure;Comedy;Fantasy|Dwayne Johnson;Kevin Hart;Jack Black|video game;jungle;body swap
Night at the Museum|2006|108|6.5|en|Comedy;Family;Fantasy|Ben Stiller;Robin Williams|museum;night guard;exhibits
Ghostbusters|1984|105|7.8|en|Comedy;Fantasy;Sci-Fi|Bill Murray;Dan Aykroyd;Sigourney Weaver|ghosts;new york;proton pack
Men in Black|1997|98|7.3|en|Comedy;Sci-Fi;Action|Tommy Lee Jones;Will Smith|aliens;agents;new york
The Fifth Element|1997|126|7.6|en|Sci-Fi;Action;Comedy|Bruce Willis;Milla Jovovich;Gary Oldman|taxi;future;chosen one
Galaxy Quest|1999|102|7.4|en|Comedy;Sci-Fi;Adventure|Tim Allen;Sigourney Weaver;Alan Rickman|tv show;aliens;parody
Hitchhiker's Guide to the Galaxy|2005|109|6.7|en|Comedy;Sci-Fi;Adventure|Martin Freeman;Sam Rockwell|towel;earth destroyed;answer 42
Scott Pilgrim vs. the World|2010|112|7.5|en|Comedy;Action;Romance|Michael Cera;Mary Elizabeth Winstead|video game;exes;band
Edge of Seventeen|2016|104|7.3|en|Comedy;Drama|Hailee Steinfeld;Woody Harrelson|teen;friendship;awkward
Booksmart|2019|102|7.1|en|Comedy|Kaitlyn Dever;Beanie Feldstein|graduation;party;friendship
Pitch Perfect|2012|112|7.1|en|Comedy;Music;Romance|Anna Kendrick;Rebel Wilson|a cappella;college;competition
The Devil Wears Prada|2006|109|6.9|en|Comedy;Drama|Meryl Streep;Anne Hathaway|fashion;boss;ambition
Bend It Like Beckham|2002|112|6.7|en|Comedy;Drama;Romance|Parminder Nagra;Keira Knightley|football;family;london
Up in the Air|2009|109|7.4|en|Comedy;Drama;Romance|George Clooney;Vera Farmiga;Anna Kendrick|layoffs;airports;loneliness
Lost in Translation|2003|102|7.7|en|Comedy;Drama;Romance|Bill Murray;Scarlett Johansson|tokyo;insomnia;connection
Soul Surfer|2011|106|7.0|en|Drama;Family|AnnaSophia Robb;Helen Hunt|surfing;shark attack;faith
The Iron Claw|2023|132|7.6|en|Drama;History|Zac Efron;Jeremy Allen White|wrestling;brothers;tragedy
Poor Things|2023|141|7.9|en|Comedy;Romance;Sci-Fi|Emma Stone;Mark Ruffalo;Willem Dafoe|reanimation;freedom;voyage
The Holdovers|2023|133|7.9|en|Comedy;Drama|Paul Giamatti;Da'Vine Joy Randolph;Dominic Sessa|boarding school;christmas;grief;holiday
Spirited|2022|127|6.6|en|Comedy;Family;Music|Will Ferrell;Ryan Reynolds|christmas;ghosts;redemption;holiday
`;

interface OpenFilm {
  id: string;
  title: string;
  year: number;
  runtimeMin: number;
  rating: number;
  genres: string[];
  cast: string[];
  keywords: string[];
  overview: string;
  streamUrl: string;
  streamType: StreamType;
}

/** CC-BY Blender Foundation open movies with verified public streams. */
const OPEN_FILMS: OpenFilm[] = [
  {
    id: 'open-bbb',
    title: 'Big Buck Bunny',
    year: 2008,
    runtimeMin: 10,
    rating: 7.4,
    genres: ['Animation', 'Comedy', 'Family'],
    cast: ['Blender Foundation'],
    keywords: ['bunny', 'revenge', 'forest', 'open movie'],
    overview:
      'A giant, gentle rabbit is pushed too far by three bullying rodents and plans a delightfully over-engineered revenge. (CC-BY Blender Foundation, streamed as HLS)',
    streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    streamType: 'HLS',
  },
  {
    id: 'open-sintel',
    title: 'Sintel',
    year: 2010,
    runtimeMin: 15,
    rating: 7.5,
    genres: ['Animation', 'Fantasy', 'Adventure'],
    cast: ['Halina Reijn', 'Thom Hoffman'],
    keywords: ['dragon', 'quest', 'loss', 'open movie'],
    overview:
      'A lonely young woman searches the world for the baby dragon she once rescued, only to face a heartbreaking truth. (CC-BY Blender Foundation)',
    streamUrl: 'https://archive.org/download/Sintel/sintel-2048-surround_512kb.mp4',
    streamType: 'MP4',
  },
  {
    id: 'open-tos',
    title: 'Tears of Steel',
    year: 2012,
    runtimeMin: 12,
    rating: 6.4,
    genres: ['Sci-Fi', 'Action'],
    cast: ['Derek de Lint', 'Sergio Hasselbaink'],
    keywords: ['robots', 'amsterdam', 'time', 'open movie'],
    overview:
      'In a future Amsterdam, a group of scientists and warriors try to rescue the world from destructive robots by revisiting a painful breakup. (CC-BY Blender Foundation)',
    streamUrl: 'https://archive.org/download/Tears-of-Steel/tears_of_steel_720p.mp4',
    streamType: 'MP4',
  },
  {
    id: 'open-ed',
    title: 'Elephants Dream',
    year: 2006,
    runtimeMin: 11,
    rating: 6.3,
    genres: ['Animation', 'Sci-Fi', 'Mystery'],
    cast: ['Tygo Gernandt', 'Cas Jansen'],
    keywords: ['machine', 'dream', 'reality', 'open movie'],
    overview:
      "Two men explore a vast, surreal machine world - one sees wonders, the other only danger. The world's first open movie. (CC-BY Blender Foundation)",
    streamUrl: 'https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4',
    streamType: 'MP4',
  },
  {
    id: 'open-cosmos',
    title: 'Cosmos Laundromat',
    year: 2015,
    runtimeMin: 12,
    rating: 7.0,
    genres: ['Animation', 'Fantasy', 'Comedy'],
    cast: ['Pilar Lopez de Ayala', 'Reinout Scholten van Aschat'],
    keywords: ['sheep', 'parallel lives', 'island', 'open movie'],
    overview:
      'On a desolate island, a suicidal sheep named Franck meets a mysterious salesman who offers him the gift of a lifetime - many lifetimes. (CC-BY Blender Foundation)',
    streamUrl:
      'https://upload.wikimedia.org/wikipedia/commons/transcoded/3/36/Cosmos_Laundromat_-_First_Cycle_-_Official_Blender_Foundation_release.webm/Cosmos_Laundromat_-_First_Cycle_-_Official_Blender_Foundation_release.webm.480p.vp9.webm',
    streamType: 'MP4',
  },
  {
    id: 'open-spring',
    title: 'Spring',
    year: 2019,
    runtimeMin: 8,
    rating: 7.6,
    genres: ['Animation', 'Fantasy', 'Family'],
    cast: ['Blender Animation Studio'],
    keywords: ['shepherd', 'dog', 'spirits', 'open movie'],
    overview:
      'A shepherd girl and her dog face ancient spirits to continue the cycle of life. (CC-BY Blender Animation Studio, played through the YouTube adapter)',
    streamUrl: 'https://www.youtube.com/watch?v=WhWc3b3KhnY',
    streamType: 'YOUTUBE',
  },
];

const ADJ: Record<string, string> = {
  Action: 'pulse-pounding',
  Adventure: 'sweeping',
  Animation: 'beautifully animated',
  Comedy: 'laugh-out-loud',
  Crime: 'gritty',
  Documentary: 'eye-opening',
  Drama: 'moving',
  Family: 'heartwarming',
  Fantasy: 'enchanting',
  History: 'sweeping historical',
  Horror: 'spine-chilling',
  Music: 'music-filled',
  Mystery: 'twisty',
  Romance: 'swoon-worthy',
  'Sci-Fi': 'mind-expanding',
  Thriller: 'tense',
  War: 'harrowing',
  Western: 'dusty frontier',
};

function overviewFor(genres: string[], keywords: string[], cast: string[]): string {
  const g0 = genres[0] ?? 'Drama';
  const kind = genres.slice(0, 2).map((g) => g.toLowerCase()).join(' ');
  const kw = keywords.slice(0, 3);
  const about = kw.length > 1 ? `${kw.slice(0, -1).join(', ')} and ${kw[kw.length - 1]}` : (kw[0] ?? 'life');
  const starring = cast.length ? ` Starring ${cast.slice(0, 2).join(' and ')}.` : '';
  const article = /^[aeiou]/i.test(ADJ[g0] ?? 'a') ? 'An' : 'A';
  return `${article} ${ADJ[g0] ?? 'gripping'} ${kind} about ${about}.${starring}`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function build(): Movie[] {
  const out: Movie[] = [];
  const seen = new Set<string>();
  for (const f of OPEN_FILMS) {
    out.push({
      id: f.id,
      title: f.title,
      originalTitle: null,
      overview: f.overview,
      year: f.year,
      runtimeMin: f.runtimeMin,
      rating: f.rating,
      popularity: 70,
      language: 'en',
      genres: f.genres,
      keywords: f.keywords,
      cast: f.cast,
      posterUrl: null,
      backdropUrl: null,
      trailerUrl: f.streamUrl,
      streamUrl: f.streamUrl,
      streamType: f.streamType,
      isFree: true,
      moods: deriveMoods(f),
    });
  }
  const lines = ROWS.split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const [title, year, runtime, rating, lang, genres, cast, keywords, original] = line.split('|');
    if (!title || !year || !runtime || !rating || !lang || !genres || !cast || !keywords) {
      throw new Error(`Malformed row: ${line}`);
    }
    const y = Number(year);
    const id = `bp-${slug(title)}-${y}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const g = genres.split(';');
    const k = keywords.split(';');
    const c = cast.split(';');
    const r = Number(rating);
    const jitter = (hashString(title) % 17) - 8;
    const recency = y >= 2015 ? 18 : y >= 2005 ? 10 : y >= 1990 ? 4 : 0;
    const popularity = Math.max(5, Math.min(100, Math.round((r - 5) * 14 + recency + jitter)));
    const runtimeMin = Number(runtime);
    out.push({
      id,
      title,
      originalTitle: original ?? null,
      overview: overviewFor(g, k, c),
      year: y,
      runtimeMin,
      rating: r,
      popularity,
      language: lang,
      genres: g,
      keywords: k,
      cast: c,
      posterUrl: null,
      backdropUrl: null,
      trailerUrl: null,
      streamUrl: null,
      streamType: null,
      isFree: false,
      moods: deriveMoods({ genres: g, keywords: k, runtimeMin }),
    });
  }
  return out;
}

const movies = build();
await writeFile(OUT, `${JSON.stringify(movies, null, 1)}\n`, 'utf8');
console.log(`Wrote ${movies.length} movies (${movies.filter((m) => m.isFree).length} open films) to ${OUT}`);
