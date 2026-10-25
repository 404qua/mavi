! native single-process MCD v6.2 SQLite extractor
program build_mcd_db_native
use, intrinsic :: iso_fortran_env, only: int64, real64
use, intrinsic :: iso_c_binding, only: c_ptr, c_null_ptr
use, intrinsic :: ieee_arithmetic, only: ieee_is_finite
use :: mcd
use :: sqlite3
use :: sqlite3_util
implicit none

integer, parameter :: NLON=64, NLAT=49, NMONTH=12, NHOUR=12, NALT=2, NCOND=4
integer, parameter :: NSURF=17, NATMO=11, NEXT=23
real, parameter :: SOL_S=88775.245
real, parameter :: ALTITUDES_M(NALT) = [2.0, 100.0]
real :: LONS(NLON), LATS(NLAT), LS_CENTERS(NMONTH), UT_HOURS(NHOUR)
integer, parameter :: SOLS_PER_MONTH(NMONTH) = [61,66,66,65,60,54,50,46,47,47,51,56]
integer, parameter :: CONDITIONS_SCENA(NCOND) = [1,8,7,5]
character(len=8), parameter :: CONDITION_NAMES(NCOND) = ['typical ', 'cold    ', 'warm    ', 'storm   ']
integer :: EXTVARKEYS(100)
integer, parameter :: EXT_NUMBERS(NEXT) = [14,15,18,21,22,23,25,26,27,29,30,31,33,34,35,36,37,38,39,40,56,57,58]
character(len=24), parameter :: EXT_NAMES(NEXT) = [character(len=24) :: &
 'tsurf','psurf','w','psurf_rms','tsurf_rms','p_rms','tair_rms','u_rms','v_rms',&
 'toa_solar','toa_solar_reflected','surface_solar','surface_solar_reflected','toa_thermal_ir',&
 'surface_thermal_ir','roughness','thermal_inertia','albedo','dust_tau_monthly','dust_tau_daily',&
 'convective_heat_flux','wind_stress','sensible_heat_flux']

character(len=*), parameter :: SURF_COLS = 'tsurf,psurf,psurf_rms,tsurf_rms,toa_solar,toa_solar_reflected,surface_solar,surface_solar_reflected,toa_thermal_ir,surface_thermal_ir,roughness,thermal_inertia,albedo,dust_tau_monthly,dust_tau_daily,wind_stress,sensible_heat_flux'
character(len=*), parameter :: ATMO_COLS = 'pres,dens,tair,u,v,w,p_rms,tair_rms,u_rms,v_rms,convective_heat_flux'
character(len=*), parameter :: SELECTED_EXTVARS = 'tsurf=14,psurf=15,w=18,psurf_rms=21,tsurf_rms=22,p_rms=23,tair_rms=25,u_rms=26,v_rms=27,toa_solar=29,toa_solar_reflected=30,surface_solar=31,surface_solar_reflected=33,toa_thermal_ir=34,surface_thermal_ir=35,roughness=36,thermal_inertia=37,albedo=38,dust_tau_monthly=39,dust_tau_daily=40,convective_heat_flux=56,wind_stress=57,sensible_heat_flux=58'


type(c_ptr) :: db
integer :: argc
character(len=1024) :: arg, db_path, dset
integer :: max_cells, i, narg
logical :: test_only, check_only, skip_index_check
logical :: wanted(0:NCOND-1), done(0:NCOND-1,0:NMONTH-1)
integer :: task_cond(0:47), task_month(0:47), ntasks, finished
integer :: rc
integer :: clock_start, clock_now, clock_rate
real(real64) :: elapsed, eta
character(len=64) :: created_utc

call init_grid()
call init_extkeys()
call parse_args(argc, db_path, dset, max_cells, test_only, check_only, skip_index_check, wanted)
if (test_only) then
    call self_test(dset)
    stop 0
end if

call open_db(db_path, max_cells, db)

if (check_only) then
    call check_db(db)
    rc = sqlite3_close(db)
    stop 0
end if

call load_done(db, done)
ntasks = 0
do i=0,NCOND-1
    if (.not. wanted(i)) cycle
    do narg=0,NMONTH-1
        if (i == 3 .and. narg < 6) cycle
        if (done(i,narg)) cycle
        task_cond(ntasks) = i
        task_month(ntasks) = narg
        ntasks = ntasks + 1
    end do
end do

write(*,'(i0," chunks to run (",i0," already done). Each chunk = 1 condition x 1 Ls month.")') ntasks, count(done)
call system_clock(clock_start, clock_rate)
finished=0

do i=0,ntasks-1
    call do_chunk(db, task_cond(i), task_month(i), max_cells, .not. skip_index_check)
    finished = finished + 1
    call system_clock(clock_now)
    elapsed = real(clock_now-clock_start,real64)/real(clock_rate,real64)
    if (finished > 0) then
        eta = elapsed/real(finished,real64)*real(ntasks-finished,real64)
    else
        eta = 0.0_real64
    end if
    write(*,'("[",i0,"/",i0,"] ",a," month ",i0," (Ls ",f0.0,") stored; elapsed ",f0.1," min, ETA ",f0.1," min")') &
        finished, ntasks, trim(CONDITION_NAMES(task_cond(i))), task_month(i), LS_CENTERS(task_month(i)+1), elapsed/60.0_real64, eta/60.0_real64
end do

write(*,'("done.")')
call check_db(db)
rc = sqlite3_close(db)

contains

subroutine init_grid()
    integer :: j
    do j=0,NLON-1
        LONS(j+1)=-180.0+5.625*real(j)
    end do
    do j=0,NLAT-1
        LATS(j+1)=90.0-3.75*real(j)
    end do
    do j=0,NMONTH-1
        LS_CENTERS(j+1)=15.0+30.0*real(j)
    end do
    do j=0,NHOUR-1
        UT_HOURS(j+1)=2.0*real(j+1)
    end do
end subroutine init_grid

subroutine init_extkeys()
    integer :: j
    EXTVARKEYS = 0
    do j=1,NEXT
        EXTVARKEYS(EXT_NUMBERS(j)) = 1
    end do
end subroutine init_extkeys

subroutine usage()
    write(*,'(a)') 'Usage: build_mcd_db_native db [--dset PATH] [--conditions typical cold warm storm] [--max-cells N] [--test] [--check] [--skip-index-check]'
end subroutine usage

subroutine parse_args(argc_out, db_out, dset_out, max_cells_out, test_out, check_out, skip_out, wanted_out)
    integer, intent(out) :: argc_out
    character(len=*), intent(out) :: db_out, dset_out
    integer, intent(out) :: max_cells_out
    logical, intent(out) :: test_out, check_out, skip_out, wanted_out(0:NCOND-1)
    integer :: k, j
    character(len=1024) :: a
    logical :: got_db
    character(len=1024) :: home
    call get_command_argument(0,a)
    argc_out = command_argument_count()
    db_out=''
    max_cells_out=0
    test_out=.false.
    check_out=.false.
    skip_out=.false.
    wanted_out=.true.
    got_db=.false.
    call get_environment_variable('HOME', home)
    if (len_trim(home) == 0) home='/home/aqua'
    dset_out=trim(home)//'/MarsData/Data/MCD/data/'
    k=1
    do while(k <= argc_out)
        call get_command_argument(k,a)
        select case(trim(a))
        case('--help','-h')
            call usage(); stop 0
        case('--test')
            test_out=.true.
        case('--check')
            check_out=.true.
        case('--skip-index-check')
            skip_out=.true.
        case('--dset')
            k=k+1; if(k>argc_out) stop 'missing value for --dset'
            call get_command_argument(k,dset_out)
            if(len_trim(dset_out)==0) stop 'empty --dset'
        case('--max-cells')
            k=k+1; if(k>argc_out) stop 'missing value for --max-cells'
            call get_command_argument(k,a)
            read(a,*) max_cells_out
            if(max_cells_out<=0 .or. max_cells_out>NLON*NLAT) stop '--max-cells must be 1..3136'
        case('--conditions')
            wanted_out=.false.
            k=k+1
            do while(k<=argc_out)
                call get_command_argument(k,a)
                if(len_trim(a)>0 .and. a(1:1)=='-') then
                    k=k-1
                    exit
                end if
                j=condition_id(trim(a))
                if(j<0) then
                    write(*,'("invalid condition: ",a)') trim(a)
                    stop 2
                end if
                wanted_out(j)=.true.
                k=k+1
            end do
            if(.not.any(wanted_out)) stop '--conditions requires at least one condition'
        case('--workers')
            stop '--workers is intentionally unsupported in the native single-process build'
        case default
            if(.not.got_db .and. a(1:1)/='-') then
                db_out=trim(a); got_db=.true.
            else
                write(*,'("unknown argument: ",a)') trim(a)
                call usage(); stop 2
            end if
        end select
        k=k+1
    end do
    if(.not.got_db .and. .not.test_out) then
        call usage(); stop 2
    end if
    if(len_trim(dset_out)>0 .and. dset_out(len_trim(dset_out):len_trim(dset_out)) /= '/') dset_out=trim(dset_out)//'/'
end subroutine parse_args

integer function condition_id(name)
    character(len=*), intent(in) :: name
    integer :: j
    condition_id=-1
    do j=0,NCOND-1
        if(trim(name)==trim(CONDITION_NAMES(j+1))) then
            condition_id=j
            return
        end if
    end do
end function condition_id

subroutine open_db(path,max_cells_in,db_out)
    character(len=*), intent(in) :: path
    integer, intent(in) :: max_cells_in
    type(c_ptr), intent(out) :: db_out
    character(:), allocatable :: errmsg
    character(len=1024) :: old_value, want_value
    logical :: found
    integer :: r, j
    r=sqlite3_open(trim(path),db_out)
    if(r/=SQLITE_OK) stop 'sqlite3_open failed'
    call exec_sql(db_out,'CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);')
    call exec_sql(db_out,'CREATE TABLE IF NOT EXISTS cond_info(cond INTEGER PRIMARY KEY, name TEXT, scena INTEGER);')
    call exec_sql(db_out,'CREATE TABLE IF NOT EXISTS altitude(alt INTEGER PRIMARY KEY, metres REAL);')
    call exec_sql(db_out,'CREATE TABLE IF NOT EXISTS grid_lat(lat_i INTEGER PRIMARY KEY, deg REAL);')
    call exec_sql(db_out,'CREATE TABLE IF NOT EXISTS grid_lon(lon_i INTEGER PRIMARY KEY, deg REAL);')
    call exec_sql(db_out,'CREATE TABLE IF NOT EXISTS ls_month(ls_month INTEGER PRIMARY KEY, ls_start REAL, ls_end REAL, ls_center REAL, sols INTEGER, earth_days REAL);')
    call exec_sql(db_out,'CREATE TABLE IF NOT EXISTS hour_info(hour INTEGER PRIMARY KEY, mars_ut_hours INTEGER, earth_hours_since_mars_midnight REAL);')
    call exec_sql(db_out,'CREATE TABLE IF NOT EXISTS scaling(variable TEXT PRIMARY KEY, factor INTEGER, unit TEXT);')
    call exec_sql(db_out,'CREATE TABLE IF NOT EXISTS chunk_done(cond INTEGER, ls_month INTEGER, n_surface INTEGER, n_atmos INTEGER, n_errors INTEGER, PRIMARY KEY(cond, ls_month));')
    call exec_sql(db_out,'CREATE TABLE IF NOT EXISTS surface(cond INTEGER, ls_month INTEGER, hour INTEGER, lat_i INTEGER, lon_i INTEGER, tsurf INTEGER, psurf INTEGER, psurf_rms INTEGER, tsurf_rms INTEGER, toa_solar INTEGER, toa_solar_reflected INTEGER, surface_solar INTEGER, surface_solar_reflected INTEGER, toa_thermal_ir INTEGER, surface_thermal_ir INTEGER, roughness INTEGER, thermal_inertia INTEGER, albedo INTEGER, dust_tau_monthly INTEGER, dust_tau_daily INTEGER, wind_stress INTEGER, sensible_heat_flux INTEGER, PRIMARY KEY(cond, ls_month, hour, lat_i, lon_i)) WITHOUT ROWID;')
    call exec_sql(db_out,'CREATE TABLE IF NOT EXISTS atmosphere(cond INTEGER, alt INTEGER, ls_month INTEGER, hour INTEGER, lat_i INTEGER, lon_i INTEGER, pres INTEGER, dens INTEGER, tair INTEGER, u INTEGER, v INTEGER, w INTEGER, p_rms INTEGER, tair_rms INTEGER, u_rms INTEGER, v_rms INTEGER, convective_heat_flux INTEGER, PRIMARY KEY(cond, alt, ls_month, hour, lat_i, lon_i)) WITHOUT ROWID;')
    call get_meta_text(db_out,'max_cells',found,old_value)
    write(want_value,'(i0)') max_cells_in
    if(found) then
        if(trim(old_value)/=trim(want_value)) then
            write(*,'(a)') 'Database was started with a different max_cells; use a different file.'
            stop 2
        end if
    end if
    call get_meta_text(db_out,'selected_extvars',found,old_value)
    if(found .and. trim(old_value)/=SELECTED_EXTVARS) stop 'Database was created with a different selected extvar set; use a new file.'
    call get_meta_text(db_out,'surface_columns',found,old_value)
    if(found .and. trim(old_value)/=SURF_COLS) stop 'Database was created with a different surface column set; use a new file.'
    call get_meta_text(db_out,'atmosphere_columns',found,old_value)
    if(found .and. trim(old_value)/=ATMO_COLS) stop 'Database was created with a different atmosphere column set; use a new file.'
    created_utc = utc_now(db_out)
    call insert_meta(db_out,'mcd_version','6.2')
    call insert_meta(db_out,'hireskey','0 (native GCM grid)')
    call insert_meta(db_out,'zkey','3 (height above local surface)')
    call insert_meta(db_out,'perturkey','1 (mean values, no perturbation)')
    call insert_meta(db_out,'max_cells',trim(want_value))
    call insert_meta(db_out,'created_utc',trim(created_utc))
    call insert_meta(db_out,'nature','modelled climatology: 12 typical days per Martian month; not measurements')
    call insert_meta(db_out,'time_axes','ls_month = Ls bin sampled at its centre; hour = Mars universal time (Martian hours)')
    call insert_meta(db_out,'source','Mars Climate Database v6.2 (LMD, LATMOS, AOPP, Open University, IAA; ESA/CNES)')
    call insert_meta(db_out,'rms_meaning','day-to-day RMS at fixed time of day (design doc 5.1); altitude-wise for zkey=3')
    call insert_meta(db_out,'flux_note','solar fluxes are post-processed by MCD (rescaled by instantaneous top-of-atmosphere flux)')
    call insert_meta(db_out,'dust_note','extvar 39 = monthly mean, 40 = daily mean visible dust optical depth above surface')
    call insert_meta(db_out,'static_columns','roughness, thermal_inertia, albedo do not vary with condition/time (GCM maps)')
    call insert_meta(db_out,'selected_extvars',SELECTED_EXTVARS)
    call insert_meta(db_out,'surface_columns',SURF_COLS)
    call insert_meta(db_out,'atmosphere_columns',ATMO_COLS)
    call exec_sql(db_out,'BEGIN;')
    do j=0,NCOND-1
        call insert_cond(db_out,j,trim(CONDITION_NAMES(j+1)),CONDITIONS_SCENA(j+1))
    end do
    do j=0,NALT-1
        call insert_altitude(db_out,j,ALTITUDES_M(j+1))
    end do
    do j=0,NLAT-1
        call insert_grid_lat(db_out,j,LATS(j+1))
    end do
    do j=0,NLON-1
        call insert_grid_lon(db_out,j,LONS(j+1))
    end do
    do j=0,NMONTH-1
        call insert_ls(db_out,j,30.0*real(j),30.0*real(j+1),LS_CENTERS(j+1),SOLS_PER_MONTH(j+1),real(SOLS_PER_MONTH(j+1))*SOL_S/86400.0)
    end do
    do j=0,NHOUR-1
        call insert_hour(db_out,j,int(UT_HOURS(j+1)),real(UT_HOURS(j+1))*SOL_S/24.0/3600.0)
    end do
    call insert_scaling_all(db_out)
    call exec_sql(db_out,'COMMIT;')
end subroutine open_db

subroutine insert_meta(db,key,value)
    type(c_ptr) :: db
    character(len=*), intent(in) :: key,value
    type(c_ptr) :: stmt
    integer :: r
    r=sqlite3_prepare_v2(db,'INSERT OR REPLACE INTO meta VALUES (?,?)',stmt); if(r/=SQLITE_OK) stop 'prepare meta failed'
    r=sqlite3_bind_text(stmt,1,trim(key)); if(r/=SQLITE_OK) stop 'bind meta key failed'
    r=sqlite3_bind_text(stmt,2,trim(value)); if(r/=SQLITE_OK) stop 'bind meta value failed'
    r=sqlite3_step(stmt); if(r/=SQLITE_DONE) stop 'step meta failed'
    r=sqlite3_finalize(stmt)
end subroutine insert_meta

subroutine insert_cond(db,c,name,scena)
    type(c_ptr) :: db
    integer,intent(in)::c,scena
    character(len=*),intent(in)::name
    call exec_sql(db,'INSERT OR REPLACE INTO cond_info VALUES ('//itoa(c)//','''//trim(name)//''','//itoa(scena)//');')
end subroutine insert_cond
subroutine insert_altitude(db,c,metres)
    type(c_ptr)::db
    integer,intent(in)::c
    real,intent(in)::metres
    call exec_sql(db,'INSERT OR REPLACE INTO altitude VALUES ('//itoa(c)//','//rtoa(metres)//');')
end subroutine insert_altitude
subroutine insert_grid_lat(db,c,deg)
    type(c_ptr)::db
    integer,intent(in)::c
    real,intent(in)::deg
    call exec_sql(db,'INSERT OR REPLACE INTO grid_lat VALUES ('//itoa(c)//','//rtoa(deg)//');')
end subroutine insert_grid_lat
subroutine insert_grid_lon(db,c,deg)
    type(c_ptr)::db
    integer,intent(in)::c
    real,intent(in)::deg
    call exec_sql(db,'INSERT OR REPLACE INTO grid_lon VALUES ('//itoa(c)//','//rtoa(deg)//');')
end subroutine insert_grid_lon
subroutine insert_ls(db,c,ls_start,ls_end,ls_center,sols,earth_days)
    type(c_ptr)::db
    integer,intent(in)::c,sols
    real,intent(in)::ls_start,ls_end,ls_center,earth_days
    call exec_sql(db,'INSERT OR REPLACE INTO ls_month VALUES ('//itoa(c)//','//rtoa(ls_start)//','//rtoa(ls_end)//','//rtoa(ls_center)//','//itoa(sols)//','//rtoa(earth_days)//');')
end subroutine insert_ls
subroutine insert_hour(db,c,mars_ut,earth_hours)
    type(c_ptr)::db
    integer,intent(in)::c,mars_ut
    real,intent(in)::earth_hours
    call exec_sql(db,'INSERT OR REPLACE INTO hour_info VALUES ('//itoa(c)//','//itoa(mars_ut)//','//rtoa(earth_hours)//');')
end subroutine insert_hour
subroutine insert_scaling_all(db)
    type(c_ptr)::db
    integer :: j
    do j=1,NEXT
        call insert_scaling(db,trim(EXT_NAMES(j)),scale_for(trim(EXT_NAMES(j))),unit_for(trim(EXT_NAMES(j))))
    end do
    call insert_scaling(db,'pres',10,'Pa')
    call insert_scaling(db,'dens',1000000,'kg/m3')
    call insert_scaling(db,'tair',10,'K')
    call insert_scaling(db,'u',100,'m/s')
    call insert_scaling(db,'v',100,'m/s')
    call insert_scaling(db,'w',100,'m/s')
end subroutine insert_scaling_all
subroutine insert_scaling(db,name,factor,unit)
    type(c_ptr)::db
    character(len=*),intent(in)::name,unit
    integer,intent(in)::factor
    call exec_sql(db,'INSERT OR REPLACE INTO scaling VALUES ('''//trim(name)//''','//itoa(factor)//','''//trim(unit)//''');')
end subroutine insert_scaling

integer function scale_for(name)
    character(len=*),intent(in)::name
    select case(trim(name))
    case('tsurf','psurf','pres','tair','psurf_rms','tsurf_rms','sensible_heat_flux'); scale_for=10
    case('dens'); scale_for=1000000
    case('u','v','w','u_rms','v_rms'); scale_for=100
    case('toa_solar','toa_solar_reflected','surface_solar','surface_solar_reflected','toa_thermal_ir','surface_thermal_ir'); scale_for=10
    case('roughness','wind_stress'); scale_for=100000
    case('thermal_inertia'); scale_for=10
    case('albedo'); scale_for=10000
    case('dust_tau_monthly','dust_tau_daily'); scale_for=1000
    case('convective_heat_flux'); scale_for=1000
    case('p_rms'); scale_for=10
    case('tair_rms'); scale_for=10
    case default; scale_for=1
    end select
end function scale_for

function unit_for(name) result(unit)
    character(len=*),intent(in)::name
    character(len=48)::unit
    select case(trim(name))
    case('tsurf','tair'); unit='K'
    case('psurf','pres','p_rms','psurf_rms'); unit='Pa'
    case('dens'); unit='kg/m3'
    case('u','v','w','u_rms','v_rms'); unit='m/s'
    case('toa_solar','toa_solar_reflected','surface_solar','surface_solar_reflected','toa_thermal_ir','surface_thermal_ir','sensible_heat_flux'); unit='W/m2'
    case('roughness'); unit='m'
    case('thermal_inertia'); unit='J m-2 K-1 s-1/2'
    case('albedo'); unit='fraction'
    case('dust_tau_monthly','dust_tau_daily'); unit='visible dust optical depth'
    case('convective_heat_flux'); unit='m/s/K'
    case('wind_stress'); unit='kg/m/s2'
    case default; unit=''
    end select
end function unit_for

subroutine load_done(db,done)
    type(c_ptr)::db
    logical,intent(out)::done(0:NCOND-1,0:NMONTH-1)
    type(c_ptr)::stmt
    integer::r,c,m
    done=.false.
    r=sqlite3_prepare_v2(db,'SELECT cond,ls_month FROM chunk_done',stmt); if(r/=SQLITE_OK) stop 'prepare chunk_done failed'
    do
        r=sqlite3_step(stmt)
        if(r==SQLITE_DONE) exit
        if(r/=SQLITE_ROW) stop 'step chunk_done failed'
        c=sqlite3_column_int(stmt,0); m=sqlite3_column_int(stmt,1)
        if(c>=0 .and. c<NCOND .and. m>=0 .and. m<NMONTH) done(c,m)=.true.
    end do
    r=sqlite3_finalize(stmt)
end subroutine load_done

subroutine do_chunk(db,cond,ls_i,max_cells_in,check_index)
    type(c_ptr)::db
    integer,intent(in)::cond,ls_i,max_cells_in
    logical,intent(in)::check_index
    type(c_ptr)::sstmt,astmt
    integer::r,h,la,lo,a,lat_i,lon_i,step_index,err_count,ier,n_surface,n_atmos,ncells_used
    integer::stride,ncells,cell_index
    real::lat,lon,lt,z,ls
    real::pres,dens,temp,zon,mer,meanvar(5),ext(100),seedout
    real::lat_try
    logical::checked,valid,need_sample
    integer::error_codes(32),error_counts(32),nerror_codes,idx
    character(len=512)::sqls
    ls=LS_CENTERS(ls_i+1)
    ncells=NLAT*NLON
    stride=1
    if(max_cells_in>0) stride=max(1,ncells/max_cells_in)
    checked=.not.check_index
    error_codes=0; error_counts=0; nerror_codes=0
    n_surface=0; n_atmos=0
    r=sqlite3_prepare_v2(db,'INSERT OR REPLACE INTO surface VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',sstmt); if(r/=SQLITE_OK) stop 'prepare surface failed'
    r=sqlite3_prepare_v2(db,'INSERT OR REPLACE INTO atmosphere VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',astmt); if(r/=SQLITE_OK) stop 'prepare atmosphere failed'
    call exec_sql(db,'BEGIN;')
    do h=0,NHOUR-1
        ncells_used=0
        do cell_index=0,ncells-1,stride
            if(ncells_used >= max_cells_in .and. max_cells_in>0) exit
            lat_i=cell_index/NLON
            lon_i=mod(cell_index,NLON)
            ncells_used=ncells_used+1
            lat=LATS(lat_i+1); lon=LONS(lon_i+1)
            lt=modulo(UT_HOURS(h+1)+lon/15.0,24.0)
            do a=0,NALT-1
                z=ALTITUDES_M(a+1)
                call sample_mcd(z,lon,lat,ls,lt,CONDITIONS_SCENA(cond+1),ier,pres,dens,temp,zon,mer,meanvar,ext,seedout)
                valid=ier==0
                if(.not.valid) then
                    idx=1
                    do while(idx<=nerror_codes .and. error_codes(idx)/=ier); idx=idx+1; end do
                    if(idx>nerror_codes .and. nerror_codes<32) then
                        nerror_codes=nerror_codes+1; error_codes(nerror_codes)=ier; error_counts(nerror_codes)=1
                    else if(idx<=nerror_codes) then
                        error_counts(idx)=error_counts(idx)+1
                    end if
                else if(.not.checked) then
                    if(abs(ext(3)-z)>1.0 .or. abs(ext(9)-ls)>0.05 .or. abs(modulo(ext(10)-lt+12.0,24.0)-12.0)>0.05) then
                        write(*,'("extvar index check failed (alt ",f0.4," vs ",f0.4,", Ls ",f0.4," vs ",f0.4,", LST ",f0.4," vs ",f0.4,")")') ext(3),z,ext(9),ls,ext(10),lt
                        stop 3
                    end if
                    checked=.true.
                end if
                if(a==0) then
                    call bind_surface(sstmt,cond,ls_i,h,lat_i,lon_i,valid,ext,r)
                    if(r/=SQLITE_DONE) stop 'surface insert failed'
                    n_surface=n_surface+1
                end if
                call bind_atmosphere(astmt,cond,a,ls_i,h,lat_i,lon_i,valid,pres,dens,temp,zon,mer,ext,r)
                if(r/=SQLITE_DONE) stop 'atmosphere insert failed'
                n_atmos=n_atmos+1
            end do
        end do
    end do
    err_count=0
    do idx=1,nerror_codes; err_count=err_count+error_counts(idx); end do
    do idx=1,nerror_codes
        write(*,'("  MCD error ",i0,": ",i0," calls")') error_codes(idx),error_counts(idx)
    end do
    r=sqlite3_finalize(sstmt)
    r=sqlite3_finalize(astmt)
    call insert_chunk_done(db,cond,ls_i,n_surface,n_atmos,err_count)
    call exec_sql(db,'COMMIT;')
    write(*,'("  ",a," Ls month ",i0," complete: surface ",i0,", atmosphere ",i0,", errors ",i0)') trim(CONDITION_NAMES(cond+1)),ls_i,n_surface,n_atmos,err_count
end subroutine do_chunk

subroutine sample_mcd(z,lon,lat,ls,lt,scena,ier,pres,dens,temp,zon,mer,meanvar,ext,seedout)
    real,intent(in)::z,lon,lat,ls,lt
    integer,intent(in)::scena
    integer,intent(out)::ier
    real,intent(out)::pres,dens,temp,zon,mer,meanvar(5),ext(100),seedout
    real::lt_try,lat_try
    integer::attempt
    lat_try=lat
    do attempt=0,1
        lt_try=lt
        call call_mcd(3,z,lon,lat_try,0,1,real(ls,8),lt_try,trim(dset),scena,1,0.0,0.0,EXTVARKEYS,pres,dens,temp,zon,mer,meanvar,ext,seedout,ier)
        if(ier==7 .and. attempt==0 .and. abs(lat)>=90.0) then
            lat_try=sign(89.999,lat)
            cycle
        end if
        exit
    end do
end subroutine sample_mcd

subroutine bind_surface(stmt,cond,ls_i,h,lat_i,lon_i,valid,ext,r)
    type(c_ptr),intent(inout)::stmt
    integer,intent(in)::cond,ls_i,h,lat_i,lon_i
    logical,intent(in)::valid
    integer,intent(out)::r
    real,intent(in)::ext(100)
    r=sqlite3_reset(stmt); if(r/=SQLITE_OK) stop 'surface reset failed'
    r=sqlite3_bind_int(stmt,1,cond); if(r/=SQLITE_OK) return
    r=sqlite3_bind_int(stmt,2,ls_i); if(r/=SQLITE_OK) return
    r=sqlite3_bind_int(stmt,3,h); if(r/=SQLITE_OK) return
    r=sqlite3_bind_int(stmt,4,lat_i); if(r/=SQLITE_OK) return
    r=sqlite3_bind_int(stmt,5,lon_i); if(r/=SQLITE_OK) return
    call bind_ext(stmt,6,14,10,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,7,15,10,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,8,21,10,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,9,22,10,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,10,29,10,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,11,30,10,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,12,31,10,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,13,33,10,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,14,34,10,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,15,35,10,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,16,36,100000,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,17,37,10,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,18,38,10000,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,19,39,1000,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,20,40,1000,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,21,57,100000,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,22,58,10,valid,ext,r); if(r/=SQLITE_OK) return
    r=sqlite3_step(stmt)
end subroutine bind_surface

subroutine bind_atmosphere(stmt,cond,alt_i,ls_i,h,lat_i,lon_i,valid,pres,dens,temp,zon,mer,ext,r)
    type(c_ptr),intent(inout)::stmt
    integer,intent(in)::cond,alt_i,ls_i,h,lat_i,lon_i
    logical,intent(in)::valid
    real,intent(in)::pres,dens,temp,zon,mer,ext(100)
    integer,intent(out)::r
    r=sqlite3_reset(stmt); if(r/=SQLITE_OK) stop 'atmosphere reset failed'
    r=sqlite3_bind_int(stmt,1,cond); if(r/=SQLITE_OK) return
    r=sqlite3_bind_int(stmt,2,alt_i); if(r/=SQLITE_OK) return
    r=sqlite3_bind_int(stmt,3,ls_i); if(r/=SQLITE_OK) return
    r=sqlite3_bind_int(stmt,4,h); if(r/=SQLITE_OK) return
    r=sqlite3_bind_int(stmt,5,lat_i); if(r/=SQLITE_OK) return
    r=sqlite3_bind_int(stmt,6,lon_i); if(r/=SQLITE_OK) return
    call bind_real(stmt,7,pres,10,valid,r); if(r/=SQLITE_OK) return
    call bind_real(stmt,8,dens,1000000,valid,r); if(r/=SQLITE_OK) return
    call bind_real(stmt,9,temp,10,valid,r); if(r/=SQLITE_OK) return
    call bind_real(stmt,10,zon,100,valid,r); if(r/=SQLITE_OK) return
    call bind_real(stmt,11,mer,100,valid,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,12,18,100,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,13,23,10,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,14,25,10,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,15,26,100,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,16,27,100,valid,ext,r); if(r/=SQLITE_OK) return
    call bind_ext(stmt,17,56,1000,valid,ext,r); if(r/=SQLITE_OK) return
    r=sqlite3_step(stmt)
end subroutine bind_atmosphere

subroutine bind_ext(stmt,pos,n,factor,valid,ext,r)
    type(c_ptr),intent(inout)::stmt
    integer,intent(in)::pos,n,factor
    logical,intent(in)::valid
    real,intent(in)::ext(100)
    integer,intent(out)::r
    if(.not.valid) then
        r=sqlite3_bind_null(stmt,pos)
    else
        call bind_real(stmt,pos,ext(n),factor,valid,r)
    end if
end subroutine bind_ext

subroutine bind_real(stmt,pos,x,factor,valid,r)
    type(c_ptr),intent(inout)::stmt
    integer,intent(in)::pos,factor
    real,intent(in)::x
    logical,intent(in)::valid
    integer,intent(out)::r
    integer(int64)::v
    if(.not.valid .or. .not.ieee_is_finite(x)) then
        r=sqlite3_bind_null(stmt,pos)
        return
    end if
    v=int(nint(real(x,real64)*real(factor,real64)),int64)
    r=sqlite3_bind_int64(stmt,pos,v)
end subroutine bind_real

subroutine insert_chunk_done(db,cond,ls_i,n_surface,n_atmos,n_errors)
    type(c_ptr)::db
    integer,intent(in)::cond,ls_i,n_surface,n_atmos,n_errors
    call exec_sql(db,'INSERT OR REPLACE INTO chunk_done VALUES ('//itoa(cond)//','//itoa(ls_i)//','//itoa(n_surface)//','//itoa(n_atmos)//','//itoa(n_errors)//');')
end subroutine insert_chunk_done

subroutine check_db(db)
    type(c_ptr)::db
    integer(int64)::chunks,surf_sum,atmo_sum,err_sum,n
    integer::j
    character(len=24), parameter :: surf_names(NSURF) = [character(len=24) :: &
      'tsurf','psurf','psurf_rms','tsurf_rms','toa_solar','toa_solar_reflected','surface_solar','surface_solar_reflected','toa_thermal_ir','surface_thermal_ir','roughness','thermal_inertia','albedo','dust_tau_monthly','dust_tau_daily','wind_stress','sensible_heat_flux']
    character(len=24), parameter :: atmo_names(NATMO) = [character(len=24) :: 'pres','dens','tair','u','v','w','p_rms','tair_rms','u_rms','v_rms','convective_heat_flux']
    call query_four_ints(db,'SELECT COUNT(*), COALESCE(SUM(n_surface),0), COALESCE(SUM(n_atmos),0), COALESCE(SUM(n_errors),0) FROM chunk_done',chunks,surf_sum,atmo_sum,err_sum)
    write(*,'("chunks done: ",i0,"/42   surface rows: ",i0,"   atmosphere rows: ",i0,"   MCD errors: ",i0)') chunks,surf_sum,atmo_sum,err_sum
    call query_one_int(db,'SELECT COUNT(*) FROM surface',n)
    write(*,'(/,"surface: ",i0," rows")') n
    write(*,'(a)') '  column                     NULLs           min           max          mean  unit'
    do j=1,NSURF
        call print_stats(db,'surface',trim(surf_names(j)))
    end do
    call query_one_int(db,'SELECT COUNT(*) FROM atmosphere',n)
    write(*,'(/,"atmosphere: ",i0," rows")') n
    write(*,'(a)') '  column                     NULLs           min           max          mean  unit'
    do j=1,NATMO
        call print_stats(db,'atmosphere',trim(atmo_names(j)))
    end do
end subroutine check_db

subroutine print_stats(db,table_name,col_name)
    type(c_ptr)::db
    character(len=*),intent(in)::table_name,col_name
    type(c_ptr)::stmt
    integer::r,typ,nulls,factor
    integer(int64)::mn,mx
    real(real64)::av
    character(len=64)::unit
    factor=scale_for(trim(col_name)); unit=trim(unit_for(trim(col_name)))
    r=sqlite3_prepare_v2(db,'SELECT SUM('//trim(col_name)//' IS NULL), MIN('//trim(col_name)//'), MAX('//trim(col_name)//'), AVG('//trim(col_name)//') FROM '//trim(table_name),stmt)
    if(r/=SQLITE_OK) stop 'prepare stats failed'
    r=sqlite3_step(stmt)
    if(r/=SQLITE_ROW) stop 'step stats failed'
    nulls=sqlite3_column_int(stmt,0)
    typ=sqlite3_column_type(stmt,1)
    if(typ==SQLITE_NULL) then
        write(*,'("  ",a25,i9,"   (no data)")') trim(col_name),nulls
    else
        mn=sqlite3_column_int64(stmt,1)
        mx=sqlite3_column_int64(stmt,2)
        av=sqlite3_column_double(stmt,3)/real(factor,real64)
        if(mn==mx) then
            write(*,'("  ",a25,i9,3f14.4,"  ",a,"   <-- constant: check")') trim(col_name),nulls,real(mn,real64)/factor,real(mx,real64)/factor,av,trim(unit)
        else
            write(*,'("  ",a25,i9,3f14.4,"  ",a)') trim(col_name),nulls,real(mn,real64)/factor,real(mx,real64)/factor,av,trim(unit)
        end if
    end if
    r=sqlite3_finalize(stmt)
end subroutine print_stats

subroutine self_test(dset_in)
    character(len=*),intent(in)::dset_in
    integer::lon_i,lat_i,j,ier
    real::lon,lat,lt,pres,dens,temp,zon,mer,meanvar(5),ext(100),seedout
    write(*,'("Node nearest InSight: lon ",f0.3,", lat ",f0.3,"; 2 m above surface, Mars UT 12 h")') nearest_lon(135.62),nearest_lat(4.50)
    write(*,'(a)') 'cond       Ls  Tsurf   Psurf    Tair       rho      u      v      w     sun   tau_m   tau_d'
    do j=0,NCOND-1
        do lon_i=0,NMONTH-1
            if(j==3 .and. LS_CENTERS(lon_i+1)<180.0) cycle
            lt=modulo(12.0+nearest_lon(135.62)/15.0,24.0)
            call call_mcd(3,2.0,nearest_lon(135.62),nearest_lat(4.50),0,1,real(LS_CENTERS(lon_i+1),8),lt,dset_in,CONDITIONS_SCENA(j+1),1,0.0,0.0,EXTVARKEYS,pres,dens,temp,zon,mer,meanvar,ext,seedout,ier)
            if(ier/=0) then
                write(*,'(a8,i4,3x,"MCD error ",i0,"  (15 = datafiles not found; 16 = failed loading a file)")') trim(CONDITION_NAMES(j+1)),int(LS_CENTERS(lon_i+1)),ier
                cycle
            end if
            if(j==0 .and. int(LS_CENTERS(lon_i+1))==15) then
                write(*,'("  index check: height=",f0.2," m (want 2), Ls=",f0.2," (want 15), LST=",f0.2," h (want ",f0.2,")")') ext(3),ext(9),ext(10),lt
            end if
            write(*,'(a8,i4,f8.1,f8.1,f8.1,f10.6,f7.2,f7.2,f7.2,f7.0,f7.2,f7.2)') trim(CONDITION_NAMES(j+1)),int(LS_CENTERS(lon_i+1)),ext(14),ext(15),temp,dens,zon,mer,ext(18),ext(31),ext(39),ext(40)
        end do
    end do
    write(*,'(/,a)') 'Check: surface pressure should dip around Ls 150-165 and peak around Ls 255; tau_d for storm should be ~5 or the call should fail visibly. MCD values are climatological model output.'
end subroutine self_test

real function nearest_lon(target)
    real,intent(in)::target
    integer::j,best
    best=0; nearest_lon=abs(LONS(1)-target)
    do j=1,NLON-1
        if(abs(LONS(j+1)-target)<nearest_lon) then
            nearest_lon=abs(LONS(j+1)-target); best=j
        end if
    end do
    nearest_lon=LONS(best+1)
end function nearest_lon

real function nearest_lat(target)
    real,intent(in)::target
    integer::j,best
    best=0; nearest_lat=abs(LATS(1)-target)
    do j=1,NLAT-1
        if(abs(LATS(j+1)-target)<nearest_lat) then
            nearest_lat=abs(LATS(j+1)-target); best=j
        end if
    end do
    nearest_lat=LATS(best+1)
end function nearest_lat

subroutine get_meta_text(db,key,found,value)
    type(c_ptr)::db
    character(len=*),intent(in)::key
    logical,intent(out)::found
    character(len=*),intent(out)::value
    type(c_ptr)::stmt
    integer::r
    found=.false.; value=''
    r=sqlite3_prepare_v2(db,'SELECT value FROM meta WHERE key=?',stmt); if(r/=SQLITE_OK) stop 'prepare meta select failed'
    r=sqlite3_bind_text(stmt,1,trim(key)); if(r/=SQLITE_OK) stop 'bind meta select failed'
    r=sqlite3_step(stmt)
    if(r==SQLITE_ROW) then
        found=.true.; value=trim(sqlite3_column_text(stmt,0))
    else if(r/=SQLITE_DONE) then
        stop 'meta select failed'
    end if
    r=sqlite3_finalize(stmt)
end subroutine get_meta_text

function utc_now(db) result(out)
    type(c_ptr)::db
    character(len=32)::out
    type(c_ptr)::stmt
    integer::r
    out='unknown'
    r=sqlite3_prepare_v2(db,"SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')",stmt)
    if(r/=SQLITE_OK) return
    r=sqlite3_step(stmt)
    if(r==SQLITE_ROW) out=trim(sqlite3_column_text(stmt,0))
    r=sqlite3_finalize(stmt)
end function utc_now

subroutine query_one_int(db,sql,val)
    type(c_ptr)::db
    character(len=*),intent(in)::sql
    integer(int64),intent(out)::val
    type(c_ptr)::stmt
    integer::r
    r=sqlite3_prepare_v2(db,trim(sql),stmt); if(r/=SQLITE_OK) stop 'prepare query failed'
    r=sqlite3_step(stmt); if(r/=SQLITE_ROW) stop 'step query failed'
    val=sqlite3_column_int64(stmt,0)
    r=sqlite3_finalize(stmt)
end subroutine query_one_int

subroutine query_four_ints(db,sql,a,b,c,d)
    type(c_ptr)::db
    character(len=*),intent(in)::sql
    integer(int64),intent(out)::a,b,c,d
    type(c_ptr)::stmt
    integer::r
    r=sqlite3_prepare_v2(db,trim(sql),stmt); if(r/=SQLITE_OK) stop 'prepare aggregate query failed'
    r=sqlite3_step(stmt); if(r/=SQLITE_ROW) stop 'step aggregate query failed'
    a=sqlite3_column_int64(stmt,0); b=sqlite3_column_int64(stmt,1); c=sqlite3_column_int64(stmt,2); d=sqlite3_column_int64(stmt,3)
    r=sqlite3_finalize(stmt)
end subroutine query_four_ints

subroutine exec_sql(db,sql)
    type(c_ptr)::db
    character(len=*),intent(in)::sql
    character(:),allocatable::errmsg
    integer::r
    r=sqlite3_exec(db,trim(sql),c_null_ptr,c_null_ptr,errmsg)
    if(r/=SQLITE_OK) then
        if(allocated(errmsg)) then
            write(*,'("SQLite error: ",a)') errmsg
        else
            write(*,'("SQLite error code: ",i0)') r
        end if
        stop 4
    end if
end subroutine exec_sql

function itoa(i) result(s)
    integer,intent(in)::i
    character(len=32)::s
    write(s,'(i0)') i
end function itoa

function rtoa(x) result(s)
    real,intent(in)::x
    character(len=64)::s
    write(s,'(g0)') x
end function rtoa

end program build_mcd_db_native
