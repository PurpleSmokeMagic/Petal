/*
 * Petal exercise catalog (shared, read only). Mirrors the `exercises` table in docs/DATA_MODEL.md.
 *
 * STATUS: draft, needs review by a qualified trainer or physiotherapist before launch.
 * Intensity is 1 (gentle) to 5 (peak). `phases` lists the phases an exercise is offered in;
 * the engine also caps intensity by phase and by today's logs (see getWorkoutPlan).
 * Figures are line drawings on a 72 x 72 grid: `.eq` marks equipment, `.fl` the floor.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetalCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ALL = ['menstrual', 'follicular', 'ovulation', 'luteal'];
  const NOT_MENSTRUAL = ['follicular', 'ovulation', 'luteal'];
  const PEAK = ['follicular', 'ovulation'];

  const FIGURES = {
    barbell: '<circle cx="36" cy="12" r="5"/><path d="M36 18L36 40L28 58"/><path d="M36 40L44 58"/><path d="M36 24L24 24"/><path d="M36 24L48 24"/><path class="eq" d="M14 24H58"/><circle class="eq" cx="14" cy="24" r="4"/><circle class="eq" cx="58" cy="24" r="4"/><path class="fl" d="M6 60H66"/>',
    legPress: '<path class="eq" d="M8 14L8 44L36 58"/><path class="eq" d="M58 12L58 44"/><circle cx="14" cy="24" r="5"/><path d="M18 30L28 46"/><path d="M28 46L42 36L54 24"/><path class="fl" d="M6 62H66"/>',
    cableRow: '<circle cx="28" cy="16" r="5"/><path d="M28 22L28 46"/><path d="M28 46L48 46L52 56"/><path d="M28 28L36 36L46 32"/><path class="eq" d="M46 32L66 32"/><path class="eq" d="M8 58H40"/><path class="fl" d="M6 62H66"/>',
    hipThrust: '<path class="eq" d="M6 44H24V58H6Z"/><circle cx="10" cy="40" r="5"/><path d="M16 44L36 34L48 38L52 56"/><circle class="eq" cx="36" cy="32" r="5"/><path class="fl" d="M6 58H66"/>',
    pulldown: '<path class="eq" d="M18 10H46"/><path class="eq" d="M32 2V10"/><circle cx="32" cy="22" r="5"/><path d="M32 28L32 46L50 46L50 58"/><path d="M32 30L24 20L22 11"/><path d="M32 30L40 20L42 11"/><path class="fl" d="M6 60H66"/>',
    backSquat: '<circle cx="38" cy="15" r="5"/><path d="M38 21L30 38L46 42L42 56L50 56"/><path class="eq" d="M22 22H54"/><circle class="eq" cx="22" cy="22" r="3"/><circle class="eq" cx="54" cy="22" r="3"/><path class="fl" d="M6 58H66"/>',
    hinge: '<circle cx="18" cy="22" r="5"/><path d="M23 26L42 30L42 58"/><path d="M27 28L28 46"/><path class="eq" d="M18 46H38"/><path class="fl" d="M6 60H66"/>',
    squat: '<circle cx="38" cy="15" r="5"/><path d="M38 21L30 38L46 42L42 56L50 56"/><path d="M37 24L56 26"/><path class="fl" d="M6 58H66"/>',
    bridge: '<circle cx="9" cy="52" r="5"/><path d="M15 52L38 38L50 40L56 56"/><path d="M15 56L32 56"/><path class="fl" d="M6 58H66"/>',
    inclinePush: '<circle cx="11" cy="33" r="5"/><path d="M17 36L58 54"/><path d="M20 38L22 56"/><path d="M58 54L62 58"/><path class="fl" d="M6 58H66"/>',
    birdDog: '<circle cx="17" cy="26" r="5"/><path d="M24 33L44 33"/><path d="M24 33L24 56"/><path d="M44 33L44 44L44 56"/><path d="M24 33L8 31"/><path d="M44 33L62 34"/><path class="fl" d="M6 58H66"/>',
    lunge: '<circle cx="34" cy="12" r="5"/><path d="M34 18L34 38"/><path d="M34 38L44 46L44 58"/><path d="M34 38L24 50L12 52"/><path class="fl" d="M6 60H66"/>',
    catCow: '<circle cx="15" cy="38" r="5"/><path d="M22 38Q35 24 46 36"/><path d="M22 38L22 57"/><path d="M46 36L46 46L46 57"/><path class="fl" d="M6 58H66"/>',
    childsPose: '<circle cx="13" cy="54" r="5"/><path d="M20 52Q34 40 46 48"/><path d="M20 53L6 58"/><path d="M46 48L54 58L64 58"/><path class="fl" d="M6 60H66"/>',
    downDog: '<circle cx="24" cy="46" r="5"/><path d="M14 58L36 22L58 58"/><path class="fl" d="M6 60H66"/>',
    warrior: '<circle cx="36" cy="12" r="5"/><path d="M36 18L36 36"/><path d="M14 26H58"/><path d="M36 36L20 58"/><path d="M36 36L52 46L52 58"/><path class="fl" d="M6 60H66"/>',
    hundred: '<circle cx="11" cy="40" r="5"/><path d="M17 44L30 52"/><path d="M30 52L54 32"/><path d="M17 48L36 52"/><path class="fl" d="M6 58H66"/>',
    sideLeg: '<circle cx="10" cy="44" r="5"/><path d="M16 48L42 52"/><path d="M42 52L62 54"/><path d="M42 52L62 38"/><path d="M16 48L30 58"/><path class="fl" d="M6 60H66"/>',
    runner: '<circle cx="40" cy="12" r="5"/><path d="M38 18L32 36"/><path d="M32 36L44 44L40 58"/><path d="M32 36L24 48L12 52"/><path d="M36 22L48 28L54 22"/><path d="M36 22L26 30L22 24"/><path class="fl" d="M6 60H66"/>',
  };

  const EXERCISES = [
    // Gym
    { slug: 'leg-press', name: 'Leg press', location: 'gym', intensity: 3, phases: ALL, figure: 'legPress', muscles: ['Quads', 'Glutes', 'Hamstrings'], dose: '3 sets of 12', description: 'Seated press with a light load. Keep your lower back on the pad and lower slowly.' },
    { slug: 'seated-cable-row', name: 'Seated cable row', location: 'gym', intensity: 2, phases: ALL, figure: 'cableRow', muscles: ['Upper back', 'Rear shoulders', 'Biceps'], dose: '3 sets of 12', description: 'Pull the handle to your ribs and squeeze your shoulder blades. Low impact for posture.' },
    { slug: 'hip-thrust', name: 'Hip thrust', location: 'gym', intensity: 3, phases: ALL, figure: 'hipThrust', muscles: ['Glutes', 'Hamstrings', 'Core'], dose: '3 sets of 10', description: 'Drive through your heels with a light bar or a dumbbell. Pause for 1 second at the top.' },
    { slug: 'lat-pulldown', name: 'Lat pulldown', location: 'gym', intensity: 2, phases: ALL, figure: 'pulldown', muscles: ['Lats', 'Biceps', 'Upper back'], dose: '3 sets of 12', description: 'Pull the bar to your upper chest with your chest lifted and shoulders down.' },
    { slug: 'back-squat', name: 'Barbell back squat', location: 'gym', intensity: 5, phases: PEAK, figure: 'backSquat', muscles: ['Quads', 'Glutes', 'Core'], dose: '4 sets of 6', description: 'Bar across your upper back, brace, and sit down between your heels. Stand up through your whole foot.' },
    { slug: 'romanian-deadlift', name: 'Romanian deadlift', location: 'gym', intensity: 4, phases: NOT_MENSTRUAL, figure: 'hinge', muscles: ['Hamstrings', 'Glutes', 'Lower back'], dose: '3 sets of 8', description: 'Soft knees, push your hips back and lower the weights along your legs with a flat back.' },

    // Body weight
    { slug: 'squats', name: 'Squats', location: 'bodyweight', intensity: 2, phases: ALL, figure: 'squat', muscles: ['Quads', 'Glutes', 'Core'], dose: '3 sets of 15', description: 'Feet shoulder width, sit back and down, and keep your knees over your toes.' },
    { slug: 'glute-bridge', name: 'Glute bridge', location: 'bodyweight', intensity: 1, phases: ALL, figure: 'bridge', muscles: ['Glutes', 'Hamstrings', 'Core'], dose: '3 sets of 15', description: 'Lie on your back, press through your heels and lift your hips until your body is in a line.' },
    { slug: 'incline-push-ups', name: 'Incline push-ups', location: 'bodyweight', intensity: 2, phases: ALL, figure: 'inclinePush', muscles: ['Chest', 'Shoulders', 'Triceps'], dose: '3 sets of 10', description: 'Hands on a bench or wall, body in one line. Lower your chest and press away.' },
    { slug: 'bird-dog', name: 'Bird dog', location: 'bodyweight', intensity: 1, phases: ALL, figure: 'birdDog', muscles: ['Core', 'Glutes', 'Lower back'], dose: '3 sets of 8 per side', description: 'On all fours, reach one arm and the opposite leg long while your hips stay level.' },
    { slug: 'reverse-lunges', name: 'Reverse lunges', location: 'bodyweight', intensity: 3, phases: NOT_MENSTRUAL, figure: 'lunge', muscles: ['Quads', 'Glutes', 'Balance'], dose: '3 sets of 10 per side', description: 'Step back, lower until both knees bend, then push through your front heel to stand.' },
    { slug: 'jump-squats', name: 'Jump squats', location: 'bodyweight', intensity: 5, phases: PEAK, figure: 'squat', muscles: ['Quads', 'Glutes', 'Calves'], dose: '3 sets of 10', description: 'Squat, then jump softly and land with bent knees. Stop if your knees or pelvic floor complain.' },

    // Yoga
    { slug: 'cat-cow', name: 'Cat cow', location: 'yoga', intensity: 1, phases: ALL, figure: 'catCow', muscles: ['Spine', 'Core', 'Upper back'], dose: '2 minutes', description: 'Flow between arching and rounding your spine with your breath. Can ease back tension.' },
    { slug: 'childs-pose', name: 'Child\'s pose', location: 'yoga', intensity: 1, phases: ALL, figure: 'childsPose', muscles: ['Lower back', 'Hips', 'Shoulders'], dose: '2 minutes', description: 'Sit back on your heels with your arms long. Rest here and breathe slowly.' },
    { slug: 'downward-dog', name: 'Downward dog', location: 'yoga', intensity: 2, phases: ALL, figure: 'downDog', muscles: ['Hamstrings', 'Calves', 'Shoulders'], dose: '5 breaths, 3 times', description: 'Hands and feet down, hips high. Bend your knees as much as you need to keep a long spine.' },
    { slug: 'warrior-two', name: 'Warrior 2', location: 'yoga', intensity: 3, phases: NOT_MENSTRUAL, figure: 'warrior', muscles: ['Legs', 'Hips', 'Shoulders'], dose: '5 breaths per side', description: 'Wide stance, front knee over your ankle, arms long. Keep your chest open.' },

    // Pilates
    { slug: 'pelvic-tilt', name: 'Pelvic tilt', location: 'pilates', intensity: 1, phases: ALL, figure: 'bridge', muscles: ['Deep core', 'Lower back'], dose: '2 sets of 10', description: 'Lie on your back with knees bent. Gently flatten your lower back into the mat, then release.' },
    { slug: 'hundred-modified', name: 'The hundred, modified', location: 'pilates', intensity: 2, phases: ALL, figure: 'hundred', muscles: ['Deep core', 'Hip flexors'], dose: '5 rounds', description: 'Head and shoulders lifted, small arm pumps. Keep knees bent if your lower back lifts.' },
    { slug: 'side-leg-lift', name: 'Side leg lift', location: 'pilates', intensity: 2, phases: ALL, figure: 'sideLeg', muscles: ['Glute medius', 'Outer thighs', 'Core'], dose: '2 sets of 12 per side', description: 'Lie on your side and lift the top leg to hip height with control.' },
    { slug: 'single-leg-stretch', name: 'Single leg stretch', location: 'pilates', intensity: 3, phases: NOT_MENSTRUAL, figure: 'hundred', muscles: ['Deep core', 'Hip flexors'], dose: '2 sets of 10 per side', description: 'Head lifted, pull one knee in as the other leg reaches long. Keep your lower back down.' },
  ];

  return { reviewed: false, FIGURES, EXERCISES };
});
