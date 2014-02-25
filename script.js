var app_options = {
    has_webcam: false,
    printing_enabled: false,
    face_confidence_step: 3,
    face_confidence_decay: 0.3,
    now_playing: false, 
    contrast_boost: 100,
    dither_expiry: 20, // frames
    delay: 20 // seconds
};


// Options
// -------
(function(){

    var printingcheckbox = document.getElementById("enableprint");
    printingcheckbox.addEventListener("click", function(cb){
        app_options.printing_enabled = this.checked;
    }, false);


    var playpause = document.getElementById("playpause");
    playpause.addEventListener("click", function(cb){

        // If app hasn't accessed webcam yet, run startup
        // -----
        if (!app_options.has_webcam) {
            app_options.now_playing = true;
            playpause.classList.add("playing");
            playpause.innerHTML = "Pause";
            get_webcam();
            return;
        }

        // Otherwise just toggle on and off
        // ----
        if (app_options.now_playing) {
            app_options.now_playing = false;
            playpause.classList.remove("playing");
            playpause.innerHTML = "Start";
        }
        else {
            app_options.now_playing = true;
            playpause.classList.add("playing");
            playpause.innerHTML = "Pause";
            tick();
        }

    }, false);


    app_options.printing_enabled = printingcheckbox.checked;

})();


// ----------------------

// V I D E O  and  C A N V A S 


var video = document.getElementById('webcam')
  , canvas = document.getElementById('canvas')
  , triangle_canvas = document.getElementById('facets')
  , face_canvas = document.getElementById('facetemp')
  , fullres_canvas = document.getElementById('fullres')
  , dither_canvas = document.getElementById('dither')
  , face_canvas_list = document.querySelectorAll('.justface')
  , dither_canvas_list = document.querySelectorAll('.dither')
  ;


// ----------------------

// C O N T E X T S

var gui
    , options
    , ctx
    , triangle_ctx
    , face_ctx
    , fullres_ctx
    ;

// ------------------------

// D A T A   S T R U C T U R E S


var img_u8
  , face_img_u8
  , corners
  , threshold;




if (dither_canvas_list.length !== face_canvas_list.length) {
    alert("Different number of dither canvases (" + dither_canvas_list.length + ") and face canvases (" + face_canvas_list.length + ") !");
}

var dithered_faces = [];
for (var i = 0; i < face_canvas_list.length; i++) {
    var dith = new DitheredFace(face_canvas_list[i], dither_canvas_list[i]);
    dithered_faces.push(dith);
}


// ------------------------

// G E T   W E B C A M


function get_webcam() {
    try {
        compatibility.getUserMedia({video: true}, function(stream) {
            try {
                video.src = compatibility.URL.createObjectURL(stream);
            } catch (error) {
                video.src = stream;
            }
            setTimeout(function() {
                app_options.has_webcam = true;
                video.play();
                start_app();
                compatibility.requestAnimationFrame(tick);
            }, 500);
        }, function (error) {
            alert("Couldn't access webcam");
        });
    } catch (error) {
        alert("Couldn't even BEGIN to access webcam");
    }
}


var demo_opt = function(){
    this.threshold = 10;
    this.resolution = 0.4;
    this.draw_borders = false;
}



// ------------------------

// S T A R T   A P P


function start_app() {

    options = new demo_opt();
    //gui = new dat.GUI();
    //gui.add(options, 'threshold', 5, 100).step(1);
    var setResolution = function(resolution) {
        var cwidth = Math.floor(640*resolution);
        var cheight = Math.floor(480*resolution);
        img_u8 = new jsfeat.matrix_t(cwidth, cheight, jsfeat.U8_t | jsfeat.C1_t);
        canvas.width = cwidth;
        canvas.height = cheight;
        var style = 'visibility: hidden; -webkit-transform: scale('+1/resolution+')';                   
        //canvas['style'] = PrefixFree.prefixCSS(style);
        canvas['style'] = style;
        triangle_ctx.setTransform(1/resolution,0,0,1/resolution,0,0);
        corners = [];
        var i = cwidth*cheight;
        while(--i >= 0) {
            corners[i] = new jsfeat.point2d_t(0,0,0,0);
            corners[i].triangles = [];
        }
    }

    
    ctx = canvas.getContext('2d');
    triangle_ctx = triangle_canvas.getContext('2d');
    face_ctx = face_canvas.getContext('2d');
    fullres_ctx = fullres_canvas.getContext('2d');

    setResolution(options.resolution);

    jsfeat.fast_corners.set_threshold(options.threshold);
    jsfeat.bbf.prepare_cascade(jsfeat.bbf.face_cascade);
}



// ------------------------

// L O O P


function tick() {
    
    if (app_options.now_playing) compatibility.requestAnimationFrame(tick);

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        var cwidth = Math.floor(640*options.resolution);
        var cheight = Math.floor(480*options.resolution);




        // DRAW FRAME
        // ----------

        ctx.drawImage(video, 0, 0, cwidth, cheight);
        fullres_ctx.drawImage(video, 0, 0, 640, 480);

        var imageData = ctx.getImageData(0, 0, cwidth, cheight);


        // CONVERT TO GRAYSCALE
        // --------------------
        jsfeat.imgproc.grayscale(imageData.data, img_u8.data);
        //jsfeat.imgproc.box_blur_gray(img_u8.data, img_u8.data, 10, 0);
        // ---------------------
        var data_u32 = new Uint32Array(imageData.data.buffer);
        var alpha = (0xff << 24);
        var i = img_u8.cols*img_u8.rows, pix = 0;
        while(--i >= 0) {
            pix = img_u8.data[i];
            data_u32[i] = alpha | (pix << 16) | (pix << 8) | pix;
        }
    


        // DETECT FACES
        // ------------
        var pyr = jsfeat.bbf.build_pyramid(img_u8, 24*2, 24*2, 4);
        var rects = jsfeat.bbf.detect(pyr, jsfeat.bbf.face_cascade);
        rects = jsfeat.bbf.group_rectangles(rects, 1);


        // DETECT CORNERS
        // ------------
        if(threshold != options.threshold) {
            threshold = options.threshold|0;
            jsfeat.fast_corners.set_threshold(threshold);
        }
        var count = jsfeat.fast_corners.detect(img_u8, corners, 5);


        var are_faces = draw_faces(ctx, rects, cwidth/img_u8.cols, 4, canvas.width); // count up to 4 faces
        face_detected_update(are_faces);


        // DITHERIZE
        // ---------
        // ditherize(canvas);
        // ditherize(face_canvas);
        // ditherize(face_canvas_list[0]);
        // ditherize(triangle_canvas);

        for (var i = 0; i < dithered_faces.length; i++) {
            dithered_faces[i].tick();
        }

    }
}




// ------------------------

// F A C E  D E T E C T I O N


// Facial progress bar
// ------------
var progress = document.getElementById("faceprogress");
var facesizeprogress = document.getElementById("facesizeprogress");
var datetime = document.getElementById('datetime');
var progress_value = 0;
var progress_max = 100;
var printer_paused = false;
function face_detected_update(are_faces) {


    if (!printer_paused) {

        if (are_faces) {
            progress_value += app_options.face_confidence_step;
        }
        else {
            progress_value -= app_options.face_confidence_decay;
        }
    }


    // If something is wrong..
    if (progress_value < 0) progress_value = 0;

    // Else we've reached maximum!
    else if (progress_value > progress_max) {
        progress_value = 0;


        datetime.innerHTML = moment().format('h:mm:ss A — D MMM YYYY');

        // Print, if appropriate
        // ---------------------
        if (app_options.printing_enabled) window.print();
        else console.log("(printing!)");


        // Set printer-throttling timer
        // ----------------------------
        printer_paused = true;
        faceprogress.className = "paused";
        setTimeout(function(){
            printer_paused = false;
            faceprogress.className = "";
        }, app_options.delay * 1000); // 45 second throttler

    } 
    progress.setAttribute("value", progress_value);
    // facesizeprogress.setAttribute("value", face_w);
}
face_detected_update(false);



// ------------------------

// F A C E  D R A W I N G

function draw_faces(ctx, rects, sc, max, cwid) {
    var on = rects.length;
    if(on && max) {
        jsfeat.math.qsort(rects, 0, on-1, function(a,b){return (b.confidence<a.confidence);})
    }
    var n = max || on;
    n = Math.min(n, on);


    var r
        , rw
        , rh
        , inset
        , face_data
        ;
    // console.log(n);

    face_ctx.clearRect(0,0,face_canvas.width, face_canvas.height);

    for(var i = 0; i < face_canvas_list.length; ++i) {
        // face_canvas_list[i].getContext('2d').clearRect(0,0,300,300);
    }


    for(var i = 0; i < n; ++i) {
        r = rects[i];
        ctx.strokeRect(
            (r.x*sc)|0,
            (r.y*sc)|0,
            (r.width*sc)|0,
            (r.height*sc)|0
        );

        inset = - r.width / 4;

        rw = (r.width  - inset*2) / options.resolution;
        rh = (r.height - inset*2) / options.resolution;

        face_data = fullres_ctx.getImageData(
            (r.x      + inset  ) / options.resolution,
            (r.y      + inset  ) / options.resolution,
            rw,
            rh
        );



        face_ctx.putImageData(contrastImage(face_data, app_options.contrast_boost), 0, 0);

        face_canvas_list[i].getContext('2d').drawImage(
            face_canvas,
            0,
            0,
            (300/rw) * 300,
            (300/rh) * 300
        );

        dithered_faces[i].update();
    }

    if (rects.length) return true; // range_to_one(rects[0].width, [22,60]);
    else return false;
}

// ------------------------

// B O O S T  C O N T R A S T

function contrastImage(imageData, contrast) {

    var data = imageData.data;
    var factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for(var i=0;i<data.length;i+=4)
    {
        data[i] = (factor * ((data[i] - 128) + 128));
        data[i+1] = (factor * ((data[i+1] - 128) + 128));
        data[i+2] = (factor * ((data[i+2] - 128) + 128));
    }
    return imageData;
}




// ------------------------

// D I T H E R


function DitheredFace(input, output) {
    var self = this
      , afterimage_max = app_options.dither_expiry
      , last_drawn = afterimage_max
      , in_canvas = input
      , out_canvas = output
      , in_ctx = in_canvas.getContext('2d')
      , out_ctx = out_canvas.getContext('2d')
      , worker = new Worker("dither.js")
      , worker_busy = false
      ;

    self.init = function() {
        out_canvas.style.display = "none";
    }

    self.update = function() {
        if (!worker_busy) {
            var imageData = in_ctx.getImageData(0,0, in_canvas.width, in_canvas.height);        
            worker.postMessage({
              imageData: imageData,
              threshold: 0.2,
              type: "atkinson"
            });
            worker_busy = true;
        }
    }

    self.tick = function() {
        if (last_drawn < afterimage_max) {
            last_drawn++;
        }
        else {
            out_canvas.style.display = "none";
        }
    }

    worker.addEventListener('message', function (e) {
        out_ctx.putImageData(e.data, 0, 0);
        worker_busy = false;
        out_canvas.style.display = "block";
        last_drawn = 0;
    }, false);

    self.init();
}





// ------------------------

// U T I L I T I E S


// 0-1 to Range and Range to 0-1
// -----------------------------

//        (b-a)(x - min)
// f(x) = --------------  + a
//           max - min

function range_to_range (x, inp, out) {
    return ( ( (out[1] - out[0])*(x - inp[0]) ) / (inp[1] - inp[0]) + out[0] );
}

function one_to_range (x, output_range) {
    return range_to_range(x, [0,1], output_range);
}

function range_to_one (x, input_range) {
    return range_to_range(x, input_range, [0,1]);
}


