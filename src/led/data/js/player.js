/* crappy browser checks */
window.AudioContext = window.AudioContext || 
    window.webkitAudioContext || 
    window.mozAudioContext || 
    window.msAudioContext;

try {
    var audioContext = new AudioContext();
    var gain = audioContext.createGain();
    gain.gain.volume = 0.9;
} catch (e) {
    $('div[role="main"]').text('Sorry, your browser doesn\'t support HTML5 features used here. Please upgrade to Chrome.').css('textAlign','center');
}
/* end browser checks */

/* globals */
var player = $('#player'), 
serverUrl = 'ws://' + location.hostname + ':8080',
//serverUrl = 'ws://yuepixels.local:8080',
ws = null,
playPause = $('#playpause', player), 
index = 0,
status = 0, // play status
song = null, 
dataInt = null, // data interval
currentBuffer = null,
songs = [], 
updates = 0,
percentLoaded = 0,
ledRow = 8,
ledColumn = 8,
frame = 60,
cmd = new Uint8Array(ledRow * ledColumn * 3),
spectrum = new Array();

playPause.click(function() {
    if (status != 1) {
        play();
    } else {
        stopSong();
    }
});

$('#selColumn').change(function() {
    ledColumn = $(this).val();
    cmd = new Uint8Array(ledRow * ledColumn * 3);
    for (var i = 0; i < ledColumn; i++) {
        spectrum[i] = new Array(ledRow);
    }
});

$('#selRow').change(function() {
    ledRow = $(this).val();
    cmd = new Uint8Array(ledRow * ledColumn * 3);
    for (var i = 0; i < ledColumn; i++) {
        spectrum[i] = new Array(ledRow);
    }
});

$('#selFrame').change(function() {
    frame = $(this).val();
});

function getWs() {
    if (ws != null) {
        return ws;
    }

    ws = new WebSocket(serverUrl);
    console.log('Connecting to YuePixels'); 
    ws.onopen = function() {
      console.log('YuePixels connected');
    };
    ws.onclose = function() {
      ws = null;
    };
    ws.onerror = function(event) {
      ws = null;
    };

    return ws;
}

function playNext() {
    if (songs[index+1] !== undefined) {
        index++;
        playSong(index);
    } else if (index != 0) {
        index = 0;
        playSong(index);
    } else {
        stopSong();
    }
}

$('#playlist').on('click', 'li', function() {
    if (!$(this).hasClass('songs')) {
        var newIndex = $('#playlist li').index(this);
        index = newIndex;
        playSong(newIndex);
    }
});

function updateProgress(evt) {
    if (evt.lengthComputable) {
        percentLoaded = Math.round((evt.loaded / evt.total) * 100);
        if (percentLoaded < 100) {
            $($('#playlist .loaded')[index]).text(percentLoaded+'%')
        }
    }
}

function sendData(analyser) {
    var array = new Uint8Array(analyser.frequencyBinCount),
        colormap_bin = [
            [0xff, 0x29, 0x00],
            [0xff, 0xe7, 0x00], 
            [0x5a, 0xff, 0x00], 
            [0x00, 0xff, 0x84], 
            [0x00, 0xd6, 0xff], 
            [0x00, 0x18, 0xff], 
            [0xad, 0x00, 0xff], 
            [0xff, 0x00, 0x8c],

            [0xc1, 0x00, 0xff],
            [0x00, 0x15, 0xff],
            [0x00, 0xec, 0xff],
            [0x00, 0xff, 0xff],
            [0x9c, 0xff, 0x00],
            [0xff, 0x8a, 0x00],
            [0xff, 0x00, 0x4c],
            [0xda, 0x00, 0xff]
        ];

    for (var i = 0; i < ledColumn; i++) {
        spectrum[i] = new Array(ledRow);
    }

    if (dataInt != null) {
        clearInterval(dataInt);
    }

    dataInt = setInterval(function() {
        analyser.getByteFrequencyData(array);
        for (var i = 0; i < ledColumn; i++) {
            for (var j = 0; j < ledRow; j++) {
                spectrum[i][j] = 0;
            }
        }
        if (status == 0) {
            return;
        };
        var measured = 1.2, 
            step = Math.round(array.length / ledColumn / measured); //sample limited data from the total array
        for (var i = 0; i < ledColumn; i++) {
            var value = array[i * step] * ledRow / 255 * 1.2;
            for (var j = 0; j < value; ++j) {
                spectrum[i][j] = value;
            }
        }

        // Drawing blocks and build command
        for (var i = 0; i < ledColumn; i++) {
            for (var j = 0; j < ledRow; j++) {
                if (spectrum[i][j] != 0) {
                    cmd[(i * ledRow + j) * 3] = colormap_bin[i][1] >> 2;
                    cmd[(i * ledRow + j) * 3 + 1] = colormap_bin[i][0] >> 2;
                    cmd[(i * ledRow + j) * 3 + 2] = colormap_bin[i][2] >> 2;
                } else {
                    cmd[(i * ledRow + j) * 3] = 0;
                    cmd[(i * ledRow + j) * 3 + 1] = 0;
                    cmd[(i * ledRow + j) * 3 + 2] = 0;
                }
          }
        }

        //console.log(cmd);
        var w = getWs();
        if ((typeof w.readyState != 'undefined') && (w.readyState == 1)) {
            w.send(cmd);
        } 
    }, 1000 / frame);
}

function playerInit() {
    var audioBufferSouceNode = audioContext.createBufferSource(),
        analyser = audioContext.createAnalyser();

    //connect the source to the analyser
    audioBufferSouceNode.connect(gain);
    gain.connect(analyser);
    gain.gain.volume = 1;

    //connect the analyser to the destination(the speaker), or we won't hear the sound
    analyser.connect(audioContext.destination);
    //then assign the buffer to the buffer source node
    audioBufferSouceNode.buffer = currentBuffer;
    
    song = audioBufferSouceNode;
    song.start(0);
    status = 1;
    song.onended = function() {
        if (status == 1) {
            playNext();
        }
    };

    sendData(analyser);
}

function startPlay(data) {
    playPause.addClass('playing');
    audioContext.decodeAudioData(data, function(buffer) {
        currentBuffer = buffer;
        //play the source
        if (song !== null) {
            song.stop(0);
        }

        playerInit();
    }, function(e) {
        console.log(e);
    });
}

function play() {
    if (status == 0) {
        status = 1;
        playPause.addClass('playing');
        playerInit();
    }
}

function stopSong() {
    status = 0;
    playPause.removeClass('playing');
    if (song !== null) {
        song.stop(0);
    }
}

function playSong(idx) {
    $('#playlist li').removeClass('active');
    $('#playlist li').eq(idx).addClass('active'); 

    var reader = new FileReader();
    reader.onprogress = updateProgress;
    reader.onloadstart = function(e) {
        $('#playlist .loaded').text('');
    }
    reader.onload = function(e) {
        $($('#playlist .loaded')[idx]).text('100%');
        stopSong();
        startPlay(e.target.result);
    }
    reader.readAsArrayBuffer(songs[idx]);
}

function fileChanged(files) {
    function getMetaData(i) {
        if (i == index) {
            $('#playlist').append('<li class="active">'+songs[i].name+' <span class="loaded">'+percentLoaded+'%</span></li>');
        }else {
            $('#playlist').append('<li>'+songs[i].name+' <span class="loaded"></span></li>');
        }
        if (j+1 < songs.length) {
            j++;
            getMetaData(j);
        }else{
            $('#playlist').removeClass('loading').append('<li class="songs"><input style="opacity:0" type="file" id="choosefiles" multiple /></li>')
        }
    }

    var oldlength = songs.length;
    for (var i = 0; i< files.length; i++) {
        if (files[i].type == 'audio/mp3' || files[i].type == 'audio/mpeg') {
            songs.push(files[i]);
        }
    }   
    var i = 0, j = 0;
    if (songs.length > oldlength) {
        $('#playlist').addClass('loading').html('');
    }
    getMetaData(0);
    if (songs.length > 0) {
        $('#playlist').css('marginTop','30px');
        if (updates === 0) {
            player.css('opacity','1');
            playSong(0);
        }
    }
    updates++;
}

$('#playlist').on('change', '#choosefiles', function(e) {
    var files = e.target.files;
    fileChanged(files);
});
